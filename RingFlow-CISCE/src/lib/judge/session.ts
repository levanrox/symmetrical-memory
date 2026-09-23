/**
 * Judge session plumbing (P3) — server-only.
 *
 * Mirrors the moderator session contract: the `judge_requests.sessionToken`
 * is the ONLY credential (the request id is public — it is broadcast and
 * polled — and must never validate). The token travels to the judge's
 * browser exclusively in the httpOnly `judge_session` cookie and is never
 * serialized into a JSON body (C1 lesson).
 */

import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { judgeRequests } from "@/db/schema";
import { assertValidSession } from "@/lib/auth/sessionValidation";
import { secureCookieFlag } from "@/lib/serverCookies";
import { isValidUuid } from "@/lib/utils";

export const JUDGE_SESSION_COOKIE = "judge_session";
/** Judge sessions live 24h — the event day plus teardown. */
export const JUDGE_SESSION_TTL_SECONDS = 24 * 60 * 60;

export interface JudgeSession {
  requestId: string;
  ringId: string;
  seatNumber: number | null;
  judgeName: string;
  expiresAt: Date | null;
}

/**
 * Validate a judge session token. Returns the session (ring-bound) or null.
 * Token-only: a matching request id is NOT sufficient (H2 contract).
 */
export async function validateJudgeSession(token: string): Promise<JudgeSession | null> {
  if (!token || !isValidUuid(token)) return null;
  const [row] = await db
    .select({
      id: judgeRequests.id,
      ringId: judgeRequests.ringId,
      seatNumber: judgeRequests.seatNumber,
      judgeName: judgeRequests.judgeName,
      sessionToken: judgeRequests.sessionToken,
      status: judgeRequests.status,
      expiresAt: judgeRequests.expiresAt,
    })
    .from(judgeRequests)
    .where(
      and(
        eq(judgeRequests.sessionToken, token),
        eq(judgeRequests.status, "approved")
      )
    )
    .limit(1);
  const valid = assertValidSession(row, token);
  if (!valid) return null;
  return {
    requestId: valid.id,
    ringId: valid.ringId,
    seatNumber: valid.seatNumber,
    judgeName: valid.judgeName,
    expiresAt: valid.expiresAt,
  };
}

/** Issue the session cookie after approval (the ONLY channel the token travels). */
export async function setJudgeSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(JUDGE_SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true, // never expose the session token to page JavaScript
    maxAge: JUDGE_SESSION_TTL_SECONDS,
    sameSite: "lax",
    secure: await secureCookieFlag(),
  });
}

/** Clear the session cookie (rejection/expiry/logout). */
export async function clearJudgeSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(JUDGE_SESSION_COOKIE);
}
