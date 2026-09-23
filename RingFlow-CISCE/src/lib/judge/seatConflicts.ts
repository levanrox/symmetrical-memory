/**
 * Seat-conflict helpers for judge approvals (P9 M-2). Pure module — no DB,
 * no Next.js — so the retry behaviour is unit-testable.
 *
 * Two moderators approving different judges at the same instant can both
 * SELECT the same lowest free seat and then race the UPDATE. The partial
 * unique index `judge_requests_ring_seat_approved_uniq`
 * (UNIQUE (ring_id, seat_number) WHERE status = 'approved') turns the loser's
 * UPDATE into a PostgreSQL 23505 instead of a silent double-assigned seat
 * (an extra vote). `withSeatConflictRetry` converts that into one retry on
 * the next free seat.
 */

/**
 * True when `err` is a PostgreSQL unique-violation (23505) — the signal that
 * a concurrent approval grabbed the same seat. postgres.js surfaces the code
 * directly; drizzle may wrap it, so walk `cause` chains.
 */
export function isSeatConflictError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (
      typeof current === "object" &&
      (current as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    current =
      typeof current === "object" ? (current as { cause?: unknown }).cause : null;
  }
  return false;
}

/**
 * Run `attempt` once; if it fails with a seat conflict (23505), run it
 * exactly once more. The retry re-reads the taken seats, so it lands on the
 * next free seat now that the concurrent winner has committed. A second
 * conflict means the race is still hot — surface a clear error instead of
 * looping. Non-conflict errors propagate untouched.
 */
export async function withSeatConflictRetry<T>(
  attempt: () => Promise<T>,
): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    if (!isSeatConflictError(err)) throw err;
  }
  try {
    return await attempt();
  } catch (retryErr) {
    if (isSeatConflictError(retryErr)) {
      throw new Error("Two approvals raced for the same seat; please try again");
    }
    throw retryErr;
  }
}
