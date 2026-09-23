/**
 * Score-entry helpers for the judge mobile UI (P4) — pure, no DOM, no Next.
 *
 * Marks are handled as INTEGER TENTHS (50-100) so 0.1-step arithmetic stays
 * exact — no 7.300000000000001 surprises on a judge's phone.
 */

export const SCORE_MIN_TENTHS = 50;
export const SCORE_MAX_TENTHS = 100;
export const SCORE_STEP_TENTHS = 1;
/** Typical first mark: stepping from "no mark" starts here, not at 5.0. */
export const SCORE_START_TENTHS = 70;
/** Whole-number quick-set row on the scoring screen. */
export const QUICK_SET_TENTHS = [50, 60, 70, 80, 90, 100] as const;

/** Round to a whole tenth and clamp into the legal 5.0-10.0 range. */
export function clampTenths(tenths: number): number {
  if (!Number.isFinite(tenths)) return SCORE_MIN_TENTHS;
  const t = Math.round(tenths);
  if (t < SCORE_MIN_TENTHS) return SCORE_MIN_TENTHS;
  if (t > SCORE_MAX_TENTHS) return SCORE_MAX_TENTHS;
  return t;
}

/**
 * One stepper tap. From "no mark" (+/- both start at 7.0 — the typical
 * mark — so a judge is at most a few taps from any common score).
 */
export function stepTenths(current: number | null, dir: 1 | -1): number {
  if (current == null) return SCORE_START_TENTHS;
  return clampTenths(current + dir * SCORE_STEP_TENTHS);
}

/** Display form: "7.3"; null renders as an em dash (no mark yet). */
export function formatTenths(tenths: number | null): string {
  if (tenths == null) return "–";
  return (clampTenths(tenths) / 10).toFixed(1);
}

/** Convert a draft tenths value to the points number the API expects. */
export function tenthsToPoints(tenths: number): number {
  return clampTenths(tenths) / 10;
}

/**
 * Client idempotency key: one uuid per (bout, side). Retries of the same
 * submit reuse it, so a flaky-4G double-tap can never double-submit.
 * Uses crypto.randomUUID() with a getRandomValues fallback for older
 * browsers.
 */
export function generateIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return (
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
      `${hex.slice(16, 20)}-${hex.slice(20)}`
    );
  }
  // Last resort (should never happen on a modern phone browser): still
  // unique enough per (bout, side) thanks to time + Math.random.
  return `key-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
