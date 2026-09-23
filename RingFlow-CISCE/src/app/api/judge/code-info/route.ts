/**
 * GET /api/judge/code-info?code= — public join-code lookup (P4).
 *
 * The judge join page needs the tatami name BEFORE the judge joins, so a
 * mis-scanned QR code is obvious at a glance. This endpoint is PUBLIC and —
 * to be honest about it — IS a validity oracle: `{ valid: true, ringName,
 * tournamentName }` versus `{ valid: false }` tells an attacker whether a
 * guessed code is live (P9 L-1). The blast radius is deliberately small: a
 * valid code only lets someone file a *pending* join request, which goes
 * nowhere without moderator approval, and the endpoint is rate-limited per
 * IP (6-char codes are guessable without throttling). Unknown / revoked /
 * expired codes all return the same generic `{ valid: false }` so at least
 * the failure reason is not leaked.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { judgeJoinCodes, rings, tournaments } from "@/db/schema";
import { checkIpRateLimit } from "@/lib/rateLimit";
import {
  isJoinCodeExpired,
  normalizeJoinCodeInput,
} from "@/lib/judge/joinCodes";

export async function GET(req: Request) {
  try {
    await checkIpRateLimit("judge/code-info", 30, 60_000);
  } catch {
    return Response.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const code = normalizeJoinCodeInput(
    new URL(req.url).searchParams.get("code")
  );

  // Explicit field selection only: join codes, ring names and tournament
  // names are display data — nothing credential-adjacent leaves here.
  const [row] = code
    ? await db
        .select({
          expiresAt: judgeJoinCodes.expiresAt,
          ringName: rings.name,
          tournamentName: tournaments.name,
        })
        .from(judgeJoinCodes)
        .innerJoin(rings, eq(judgeJoinCodes.ringId, rings.id))
        .innerJoin(tournaments, eq(rings.tournamentId, tournaments.id))
        .where(
          and(
            eq(judgeJoinCodes.code, code),
            isNull(judgeJoinCodes.revokedAt)
          )
        )
        .limit(1)
    : [];

  if (!row || isJoinCodeExpired(row.expiresAt)) {
    // Same response for unknown/revoked/expired: don't help enumerators.
    return Response.json({ valid: false });
  }

  return Response.json({
    valid: true,
    ringName: row.ringName,
    tournamentName: row.tournamentName,
  });
}
