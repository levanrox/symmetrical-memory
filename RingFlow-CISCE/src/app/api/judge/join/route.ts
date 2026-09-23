/**
 * POST /api/judge/join — judge join requests.
 *
 * Body: { code, name }. Validates the join code (active, unexpired,
 * unrevoked) and creates a PENDING judge_requests row. Returns ONLY the
 * request id — no session is issued here; the moderator approves first and
 * the judge polls /api/judge/status.
 *
 * Rate-limited per IP (6-char codes are guessable without throttling).
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { judgeJoinCodes, judgeRequests } from "@/db/schema";
import { checkIpRateLimit } from "@/lib/rateLimit";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import {
  isJoinCodeExpired,
  normalizeJoinCodeInput,
  sanitizeJudgeName,
} from "@/lib/judge/joinCodes";

export async function POST(req: Request) {
  try {
    await checkIpRateLimit("judge/join", 10, 60_000);
  } catch {
    return Response.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  let body: { code?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = sanitizeJudgeName(body?.name);
  if (!name) {
    return Response.json(
      { error: "Please enter your name (1-40 characters)." },
      { status: 400 }
    );
  }

  const code = normalizeJoinCodeInput(body?.code);
  if (!code) {
    return Response.json({ error: "A join code is required." }, { status: 400 });
  }

  // Explicit field selection — judge_requests rows are never read here, and
  // session tokens never leave the server (C1 lesson).
  const [joinCode] = await db
    .select({
      id: judgeJoinCodes.id,
      ringId: judgeJoinCodes.ringId,
      expiresAt: judgeJoinCodes.expiresAt,
    })
    .from(judgeJoinCodes)
    .where(
      and(eq(judgeJoinCodes.code, code), isNull(judgeJoinCodes.revokedAt))
    )
    .limit(1);

  if (!joinCode || isJoinCodeExpired(joinCode.expiresAt)) {
    // Same message for unknown/revoked/expired codes: don't help enumerators.
    return Response.json(
      { error: "Invalid or expired join code." },
      { status: 400 }
    );
  }

  const [request] = await db
    .insert(judgeRequests)
    .values({
      ringId: joinCode.ringId,
      joinCodeUsed: code,
      judgeName: name,
      status: "pending",
    })
    .returning({ id: judgeRequests.id });

  if (!request) {
    return Response.json(
      { error: "Could not create the join request. Please try again." },
      { status: 500 }
    );
  }

  // Wake the moderator desk so the pending request appears live.
  broadcastLiveEvent({
    table: "judge_requests",
    op: "INSERT",
    id: request.id,
    ringId: joinCode.ringId,
    data: { judgeName: name },
  });

  // NOTE: only the request id. The session is issued on approval and
  // travels exclusively in the httpOnly cookie set by /api/judge/status.
  return Response.json({ requestId: request.id });
}
