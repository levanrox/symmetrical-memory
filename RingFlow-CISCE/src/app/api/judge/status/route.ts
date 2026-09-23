/**
 * GET /api/judge/status?requestId= — judge approval polling.
 *
 * The judge's join page polls this after POST /api/judge/join. While the
 * moderator hasn't decided: { approved: false, status: "pending" }. On
 * approval the session is issued as the httpOnly `judge_session` cookie AND
 * the response carries { approved: true, seatNumber, ringName,
 * tournamentName }. On rejection/expiry the cookie is cleared.
 *
 * The sessionToken NEVER appears in any JSON body (C1 lesson) — the cookie
 * is the only channel it travels.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { judgeRequests, rings, tournaments } from "@/db/schema";
import { checkIpRateLimit } from "@/lib/rateLimit";
import { isValidUuid } from "@/lib/utils";
import {
  clearJudgeSessionCookie,
  setJudgeSessionCookie,
} from "@/lib/judge/session";

export async function GET(req: Request) {
  // Polling endpoint: generous per-IP budget (judges behind venue WiFi share
  // a NAT address; a 3s poll is 20 req/min per device).
  try {
    await checkIpRateLimit("judge/status", 120, 60_000);
  } catch {
    return Response.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const requestId = new URL(req.url).searchParams.get("requestId");
  if (!requestId || !isValidUuid(requestId)) {
    return Response.json({ error: "A valid requestId is required." }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: judgeRequests.id,
      status: judgeRequests.status,
      seatNumber: judgeRequests.seatNumber,
      ringId: judgeRequests.ringId,
      sessionToken: judgeRequests.sessionToken,
      expiresAt: judgeRequests.expiresAt,
    })
    .from(judgeRequests)
    .where(eq(judgeRequests.id, requestId))
    .limit(1);

  if (!row) {
    return Response.json(
      { approved: false, status: "not_found" },
      { status: 404 }
    );
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    await clearJudgeSessionCookie();
    return Response.json({ approved: false, status: "expired" });
  }

  if (row.status === "approved" && row.sessionToken) {
    // Issue the session via the httpOnly cookie — the token itself is never
    // serialized into the response body.
    await setJudgeSessionCookie(row.sessionToken);

    const [ring] = await db
      .select({
        name: rings.name,
        tournamentId: rings.tournamentId,
      })
      .from(rings)
      .where(eq(rings.id, row.ringId))
      .limit(1);
    const [tournament] = ring
      ? await db
          .select({ name: tournaments.name })
          .from(tournaments)
          .where(eq(tournaments.id, ring.tournamentId))
          .limit(1)
      : [];

    return Response.json({
      approved: true,
      status: "approved",
      seatNumber: row.seatNumber,
      ringName: ring?.name ?? null,
      tournamentName: tournament?.name ?? null,
    });
  }

  if (row.status === "pending") {
    return Response.json({ approved: false, status: "pending" });
  }

  // rejected / revoked / expired: make sure no stale session cookie survives.
  await clearJudgeSessionCookie();
  return Response.json({ approved: false, status: row.status });
}
