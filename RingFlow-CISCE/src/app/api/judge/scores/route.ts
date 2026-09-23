/**
 * POST /api/judge/scores — judge score submission.
 *
 * Body: { matchId, side, score, idempotencyKey? }.
 *
 * Auth: the httpOnly `judge_session` cookie (issued on approval). A judge
 * token authorizes scores for exactly ONE thing — the ACTIVE live bout on
 * their own ring — enforced by `assertJudgeScoreScope`:
 *   token -> ring -> match is LIVE on that ring AND is the ring's
 *   current (active) bout.
 *
 * Writes are idempotent: a client idempotency key returns the original row
 * on retry; otherwise the write upserts on (matchId, judgeRequestId, side)
 * so a judge re-submitting a mark corrects it. Scores are validated with
 * P1's `validateJudgeScore` and stored as integer tenths.
 *
 * Every write is rate-limited per session; the endpoint is per-IP limited
 * too. The moderator tally updates live via the `kata_scores` broadcast.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  categories,
  categoryAssignments,
  kataScores,
  matches,
  rings,
} from "@/db/schema";
import { checkIpRateLimit, checkRateLimit } from "@/lib/rateLimit";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { isKataCategory } from "@/lib/draws/generateDraws";
import {
  JUDGE_SESSION_COOKIE,
  validateJudgeSession,
} from "@/lib/judge/session";
import {
  assertJudgeScoreScope,
  parseKataSide,
  planScoreWrite,
  scoreToTenths,
} from "@/lib/judge/scores";

/** Rate-limit key that doesn't keep the raw credential in the bucket map. */
function sessionRateLimitKey(token: string): string {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return `judge/scores:${digest}`;
}

export async function POST(req: Request) {
  try {
    await checkIpRateLimit("judge/scores", 120, 60_000);
  } catch {
    return Response.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;
  const session = await validateJudgeSession(token ?? "");
  if (!session) {
    return Response.json(
      { error: "Not authorized. Please rejoin with a judge code." },
      { status: 401 }
    );
  }

  // Per-session throttle (a judge submits at most a few marks per minute).
  try {
    checkRateLimit(sessionRateLimitKey(token as string), 30, 60_000);
  } catch {
    return Response.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  let body: { matchId?: unknown; side?: unknown; score?: unknown; idempotencyKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const matchId = typeof body?.matchId === "string" ? body.matchId : "";
  if (!matchId) {
    return Response.json({ error: "matchId is required." }, { status: 400 });
  }

  let side: "AKA" | "AO";
  try {
    side = parseKataSide(body?.side);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  let scoreTenths: number;
  try {
    scoreTenths = scoreToTenths(body?.score);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  const idempotencyKey =
    typeof body?.idempotencyKey === "string" && body.idempotencyKey.length > 0
      ? body.idempotencyKey
      : null;
  if (idempotencyKey && idempotencyKey.length > 128) {
    return Response.json(
      { error: "idempotencyKey is too long (max 128 chars)." },
      { status: 400 }
    );
  }

  // Match + scope checks.
  const [match] = await db
    .select({
      id: matches.id,
      categoryId: matches.categoryId,
      status: matches.status,
    })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!match) {
    return Response.json({ error: "Bout not found." }, { status: 404 });
  }
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, name: categories.name })
    .from(categories)
    .where(eq(categories.id, match.categoryId))
    .limit(1);
  if (!cat || !(await isKataCategory({ tournamentId: cat.tournamentId, name: cat.name }))) {
    return Response.json(
      { error: "Judge scoring is only for kata bouts." },
      { status: 403 }
    );
  }
  const [assignment] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.categoryId, match.categoryId),
        eq(categoryAssignments.status, "running")
      )
    )
    .limit(1);
  const [ring] = await db
    .select({ currentMatchId: rings.currentMatchId })
    .from(rings)
    .where(eq(rings.id, session.ringId))
    .limit(1);

  try {
    assertJudgeScoreScope({
      judgeRingId: session.ringId,
      matchRingId: assignment?.ringId ?? null,
      matchStatus: match.status,
      ringCurrentMatchId: ring?.currentMatchId ?? null,
      matchId,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 403 });
  }

  // Idempotent write: key hit -> return the original row; otherwise upsert
  // on (matchId, judgeRequestId, side).
  if (idempotencyKey) {
    const [byKey] = await db
      .select({ id: kataScores.id })
      .from(kataScores)
      .where(eq(kataScores.idempotencyKey, idempotencyKey))
      .limit(1);
    if (byKey) {
      return Response.json({ success: true, scoreId: byKey.id, duplicate: true });
    }
  }
  const [byScope] = await db
    .select({ id: kataScores.id })
    .from(kataScores)
    .where(
      and(
        eq(kataScores.matchId, matchId),
        eq(kataScores.judgeRequestId, session.requestId),
        eq(kataScores.side, side)
      )
    )
    .limit(1);

  // Pure idempotency plan (the by-key duplicate case returned above, so the
  // first arg is always null here): "insert" vs "update" decides the event op.
  const plan = planScoreWrite(null, byScope ?? null);

  let scoreId: string;
  try {
    const [row] = await db
      .insert(kataScores)
      .values({
        matchId,
        judgeRequestId: session.requestId,
        seatNumber: session.seatNumber ?? 0,
        side,
        scoreTenths,
        isManual: false,
        idempotencyKey,
      })
      .onConflictDoUpdate({
        target: [kataScores.matchId, kataScores.judgeRequestId, kataScores.side],
        set: { scoreTenths, isManual: false },
      })
      .returning({ id: kataScores.id });
    if (!row) throw new Error("score write failed");
    scoreId = row.id;
  } catch (err: unknown) {
    // Lost a race with another request carrying the same idempotency key:
    // report the original row as a duplicate instead of a 500.
    if ((err as { code?: string })?.code === "23505" && idempotencyKey) {
      const [byKey] = await db
        .select({ id: kataScores.id })
        .from(kataScores)
        .where(eq(kataScores.idempotencyKey, idempotencyKey))
        .limit(1);
      if (byKey) {
        return Response.json({ success: true, scoreId: byKey.id, duplicate: true });
      }
    }
    throw err;
  }

  broadcastLiveEvent({
    table: "kata_scores",
    op: plan === "update" ? "UPDATE" : "INSERT",
    id: scoreId,
    matchId,
    ringId: session.ringId,
    categoryId: match.categoryId,
    data: {
      seatNumber: session.seatNumber,
      side,
      scoreTenths,
      isManual: false,
    },
  });

  return Response.json({
    success: true,
    scoreId,
    duplicate: false,
  });
}
