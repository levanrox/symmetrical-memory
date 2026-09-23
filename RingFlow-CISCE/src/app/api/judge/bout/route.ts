/**
 * GET /api/judge/bout — the judge's ring current bout (P4).
 *
 * Auth: the httpOnly `judge_session` cookie (same contract as
 * /api/judge/scores). Scope-checked exactly like the scores endpoint: the
 * session authorizes reads for the ACTIVE bout on the judge's OWN ring only
 * (ring's currentMatchId -> match is a kata bout on that ring and LIVE).
 *
 * Responses:
 *   { noLiveBout: true }                                              — ring idle
 *   { boutState: "live", matchId, ringId, ringName,
 *     aka: { name, kataNumber, kataName }, ao: { ... },
 *     myScores: { aka: number|null, ao: number|null } }                — score it
 *   { boutState: "confirmed", matchId, ringId, ringName,
 *     aka: { name }, ao: { name },
 *     winnerSide: "AKA"|"AO"|null, akaVotes, aoVotes }                — result flash
 *
 * `myScores` carries this judge's own submitted marks (integer tenths ->
 * points) so a page reload or a second device keeps "tap to change" working.
 * The confirmed payload is read-only tally data for the result flash; the
 * judge can still edit while LIVE (P3 upsert), never after.
 */

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  athletes,
  categories,
  categoryAssignments,
  kataScores,
  matches,
  matchSlots,
  rings,
} from "@/db/schema";
import {
  decideKataBout,
  KataDecisionError,
} from "@/engine/rules-engine/rulesets/kata-decision";
import { getKataName } from "@/engine/rules-engine/rulesets/kata-list";
import { checkIpRateLimit } from "@/lib/rateLimit";
import { isKataCategory } from "@/lib/draws/generateDraws";
import {
  JUDGE_SESSION_COOKIE,
  validateJudgeSession,
} from "@/lib/judge/session";
import {
  assertJudgeScoreScope,
  kataScoresToJudgeInputs,
} from "@/lib/judge/scores";

const NO_BOUT = { noLiveBout: true } as const;

interface SideInfo {
  name: string;
  kataNumber: number | null;
  kataName: string | null;
}

export async function GET() {
  try {
    // Polling endpoint: judges behind venue WiFi share a NAT address.
    await checkIpRateLimit("judge/bout", 120, 60_000);
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

  const [ring] = await db
    .select({ currentMatchId: rings.currentMatchId, name: rings.name })
    .from(rings)
    .where(eq(rings.id, session.ringId))
    .limit(1);
  if (!ring?.currentMatchId) return Response.json(NO_BOUT);

  const [match] = await db
    .select({
      id: matches.id,
      categoryId: matches.categoryId,
      status: matches.status,
      winnerSide: matches.winnerSide,
      akaKataNumber: matches.akaKataNumber,
      aoKataNumber: matches.aoKataNumber,
    })
    .from(matches)
    .where(eq(matches.id, ring.currentMatchId))
    .limit(1);
  if (!match) return Response.json(NO_BOUT);

  // Same kata-category + ring-binding scope as the scores endpoint.
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, name: categories.name })
    .from(categories)
    .where(eq(categories.id, match.categoryId))
    .limit(1);
  if (!cat || !(await isKataCategory({ tournamentId: cat.tournamentId, name: cat.name }))) {
    return Response.json(NO_BOUT);
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
  if (!assignment || assignment.ringId !== session.ringId) {
    return Response.json(NO_BOUT);
  }

  // Athlete names for both sides (position 1 = AKA, 2 = AO).
  const slots = await db
    .select({ position: matchSlots.position, name: athletes.name })
    .from(matchSlots)
    .leftJoin(athletes, eq(matchSlots.athleteId, athletes.id))
    .where(eq(matchSlots.matchId, match.id));
  const akaSlot = slots.find((s) => s.position === 1);
  const aoSlot = slots.find((s) => s.position === 2);

  if (match.status === "LIVE") {
    // Reuse the exact scope assertion the write path uses.
    try {
      assertJudgeScoreScope({
        judgeRingId: session.ringId,
        matchRingId: assignment.ringId,
        matchStatus: match.status,
        ringCurrentMatchId: ring.currentMatchId,
        matchId: match.id,
      });
    } catch {
      return Response.json(NO_BOUT);
    }

    const myRows = await db
      .select({ side: kataScores.side, scoreTenths: kataScores.scoreTenths })
      .from(kataScores)
      .where(
        and(
          eq(kataScores.matchId, match.id),
          eq(kataScores.judgeRequestId, session.requestId)
        )
      );
    const myScores: { aka: number | null; ao: number | null } = {
      aka: null,
      ao: null,
    };
    for (const r of myRows) {
      if (r.side === "AKA") myScores.aka = r.scoreTenths / 10;
      else if (r.side === "AO") myScores.ao = r.scoreTenths / 10;
    }

    const side = (
      slot: { name: string | null } | undefined,
      kataNumber: number | null
    ): SideInfo => ({
      name: slot?.name ?? "—",
      kataNumber,
      kataName: kataNumber != null ? (getKataName(kataNumber) ?? null) : null,
    });

    return Response.json({
      boutState: "live",
      matchId: match.id,
      ringId: session.ringId,
      ringName: ring.name,
      aka: side(akaSlot, match.akaKataNumber),
      ao: side(aoSlot, match.aoKataNumber),
      myScores,
    });
  }

  if (match.status === "COMPLETED" || match.status === "CONFIRMED") {
    // Result flash for the just-decided bout. Tally from all submitted
    // marks with the P1 decision engine (read-only); fall back to the
    // stored winnerSide when there are no countable votes.
    let akaVotes: number | null = null;
    let aoVotes: number | null = null;
    try {
      const rows = await db
        .select({
          judgeRequestId: kataScores.judgeRequestId,
          seatNumber: kataScores.seatNumber,
          side: kataScores.side,
          scoreTenths: kataScores.scoreTenths,
        })
        .from(kataScores)
        .where(eq(kataScores.matchId, match.id));
      const decision = decideKataBout(kataScoresToJudgeInputs(rows));
      akaVotes = decision.akaVotes;
      aoVotes = decision.aoVotes;
    } catch (err) {
      // No countable votes (e.g. moderator-decided) — not fatal for the
      // result flash; the stored winnerSide still renders.
      if (!(err instanceof KataDecisionError)) throw err;
    }
    const winnerSide =
      match.winnerSide === "AKA" || match.winnerSide === "AO"
        ? match.winnerSide
        : null;

    return Response.json({
      boutState: "confirmed",
      matchId: match.id,
      ringId: session.ringId,
      ringName: ring.name,
      aka: { name: akaSlot?.name ?? "—" },
      ao: { name: aoSlot?.name ?? "—" },
      winnerSide,
      akaVotes,
      aoVotes,
    });
  }

  return Response.json(NO_BOUT);
}
