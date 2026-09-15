'use client';

import { useEffect, useRef, useState } from 'react';

interface ClockReading {
  elapsedMs: number;
  running: boolean;
}

/**
 * The match clock, driven from the client's own receipt time.
 *
 * Two things this deliberately avoids, both of which produced a clock that
 * visibly jumped:
 *
 * 1. **Comparing the server's timestamp to this machine's clock.** The server
 *    sends `startedAtMs` in its own epoch. Subtracting a browser's `Date.now()`
 *    from that is a cross-machine comparison, so any skew between the two shows
 *    up as a constant offset on the display. The anchor here is taken from
 *    `Date.now()` at the moment a reading *arrived* — the same clock that will
 *    read it on the next tick — so there is nothing to be skewed.
 *
 * 2. **Memoising the result against the match object.** The match only changes
 *    when the ring queue is polled, so a memo keyed on it froze the display
 *    between polls and then jumped the whole interval at once. This recomputes
 *    on every tick instead.
 *
 * The server still owns the clock: this only interpolates between its readings,
 * and re-anchors whenever a new one arrives.
 */
export function useMatchClock(
  reading: ClockReading | null,
  durationSeconds: number | null,
): number | null {
  const [, tick] = useState(0);
  const anchor = useRef<{ elapsedMs: number; running: boolean; at: number } | null>(null);

  const elapsedMs = reading?.elapsedMs ?? null;
  const running = reading?.running ?? null;

  useEffect(() => {
    anchor.current =
      elapsedMs === null || running === null ? null : { elapsedMs, running, at: Date.now() };
  }, [elapsedMs, running]);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(timer);
  }, []);

  if (anchor.current === null || durationSeconds === null) return null;

  const { elapsedMs: base, running: isRunning, at } = anchor.current;
  const elapsed = base + (isRunning ? Math.max(0, Date.now() - at) : 0);

  return durationSeconds * 1000 - elapsed;
}

/** True inside the ruleset's warning window, so the clock can shout. */
export function isTimeWarning(remainingMs: number | null, warnAtMs = 15_000): boolean {
  return remainingMs !== null && remainingMs <= warnAtMs && remainingMs >= 0;
}
