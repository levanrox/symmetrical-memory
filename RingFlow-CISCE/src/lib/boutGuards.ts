/**
 * Pure bout-write guards (no I/O).
 *
 * These live here — NOT in `src/actions/matches.ts` — because Next.js
 * requires every export of a `"use server"` module to be an async function.
 * A synchronous export there breaks `next build` ("Server Actions must be
 * async functions"). Import from `@/lib/boutGuards` in server actions,
 * components, and unit tests.
 */

/**
 * Pure idempotency/conflict decision for bout confirmation, extracted so it
 * can be unit-tested without a database.
 */
export function resolveConfirmOutcome(
  currentStatus: string | null | undefined,
  currentWinnerId: string | null | undefined,
  newWinnerId: string
): "proceed" | "duplicate" | "conflict" {
  if (currentStatus !== "CONFIRMED") return "proceed";
  // A confirmed bout with no recorded winner has nothing to conflict with —
  // allow (re)setting it (admin repair path for legacy/incomplete rows).
  if (currentWinnerId == null) return "proceed";
  return currentWinnerId === newWinnerId ? "duplicate" : "conflict";
}

/**
 * Server-side score range validation. Scores arrive from moderator devices;
 * never trust them blindly — a malformed or malicious client must not be
 * able to persist NaN, negative, or absurd values. Karate bout scores are
 * small non-negative integers; 0–99 is a generous bound.
 */
export function clampScore(value: number | null | undefined, field: string): number {
  const n = value ?? 0;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`Invalid ${field}: must be an integer 0–99`);
  }
  return n;
}

/**
 * Pure ring-binding check for bout writes (unit-testable).
 *
 * A moderator token authorizes writes for ONE ring. `authorizeBoutWrite`
 * validates the token against the caller-supplied `ringId`, but without this
 * check a ring-A moderator could pass ring A's id while rewriting a ring-B
 * match. The match's true ring (resolved from its category assignment) must
 * equal the ring the caller claimed.
 *
 * Throws on mismatch. When the caller made no ring claim (`suppliedRingId`
 * nullish) there is nothing to bind — the caller authorized another way
 * (admin/organiser).
 */
export function assertMatchRingBinding(
  resolvedRingId: string | null,
  suppliedRingId: string | null | undefined
): void {
  if (!suppliedRingId) return;
  if (!resolvedRingId) {
    throw new Error("Match is not currently assigned to a ring");
  }
  if (resolvedRingId !== suppliedRingId) {
    throw new Error("Match does not belong to this ring");
  }
}
