"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CLOCK_OFFSET_SAMPLES,
  MATCH_CLOCK_TICK_MS,
  clockOffsetFromResponse,
  clockOffsetMs,
  isExpired as isExpiredFor,
  isLowTime,
  medianOffset,
  remainingMs as remainingFor,
  type RingClock,
} from "@/lib/matchClock";

export interface ClockSyncSample {
  /** Server clock at the moment the payload was produced. */
  serverNow: number;
  /** Local clock when the request that produced the payload was sent. */
  sentAt?: number;
  /**
   * Local clock when that response landed. Pass it from the call site: by the
   * time a React effect runs, another frame or two has already gone by, and
   * that delay would be charged to the network as clock error.
   */
  receivedAt?: number;
}

export interface MatchClockState {
  remainingMs: number;
  /** Local device clock minus server clock, in ms (0 until the first sample). */
  offsetMs: number;
  isLow: boolean;
  isExpired: boolean;
}

/**
 * Renders the persistent match clock and keeps it honest.
 *
 * The server state is the only source of truth; this hook interpolates between
 * payloads with `requestAnimationFrame`, corrected by the measured server clock
 * offset, so two devices showing the same clock never drift apart because their
 * system clocks disagree.
 *
 * Pass a memoized `clock` (see `normalizeClock`).
 */
export function useMatchClock(
  clock: RingClock,
  sync?: ClockSyncSample | null,
  options?: { onComplete?: () => void }
): MatchClockState {
  const clockKey = `${clock.status}|${clock.durationMs}|${clock.accumulatedMs}|${clock.startedAtMs ?? 0}`;

  const clockRef = useRef(clock);
  const offsetRef = useRef(0);
  const samplesRef = useRef<{ rtt: number; offset: number }[]>([]);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(options?.onComplete);

  // Keep the "latest value" refs in sync after commit. Declared before the
  // consumers below so they always observe the current clock in the same pass.
  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  useEffect(() => {
    onCompleteRef.current = options?.onComplete;
  }, [options?.onComplete]);

  const [remaining, setRemaining] = useState(() => remainingFor(clock, Date.now()));
  const [offset, setOffset] = useState(0);

  // Fold every fresh server sample into the offset estimate.
  //
  // The NTP rule applies: the response that came back fastest carries the least
  // path asymmetry, so it is the most trustworthy. Samples are filtered to the
  // quickest round trip first, then medianed — a slow response can never drag
  // the clock, whatever the machine happens to be busy with.
  useEffect(() => {
    if (!sync || typeof sync.serverNow !== "number") return;

    const receivedAt = typeof sync.receivedAt === "number" ? sync.receivedAt : Date.now();
    const sentAt = typeof sync.sentAt === "number" ? sync.sentAt : null;
    const rtt = sentAt === null ? Number.POSITIVE_INFINITY : Math.max(0, receivedAt - sentAt);
    // Without a send timestamp the round trip is unknown, so the value can only
    // be trusted as a first guess — never as a correction to a measured one.
    if (sentAt === null) {
      if (samplesRef.current.length === 0) {
        const fallback = clockOffsetFromResponse(sync.serverNow, receivedAt);
        offsetRef.current = fallback;
        setOffset(fallback);
      }
      return;
    }

    const offset = clockOffsetMs(sync.serverNow, sentAt, receivedAt);
    samplesRef.current = [...samplesRef.current, { rtt, offset }].slice(-CLOCK_OFFSET_SAMPLES);

    const samples = samplesRef.current;
    let next = offset;

    if (samples.length > 0) {
      const bestRtt = Math.min(...samples.map((s) => s.rtt));
      // A few milliseconds of slack keeps equally-fast responses in the pool.
      const cutoff = Math.max(bestRtt * 1.2, bestRtt + 5);
      const best = samples.filter((s) => s.rtt <= cutoff);
      next = medianOffset(best.map((s) => s.offset));
    }

    offsetRef.current = next;
    setOffset(next);
  }, [sync?.serverNow, sync?.sentAt, sync?.receivedAt]);

  // Re-anchor whenever the server state itself changes.
  useEffect(() => {
    if (clockKey.endsWith("|running")) completedRef.current = false;
    setRemaining(remainingFor(clockRef.current, Date.now() + offsetRef.current));
  }, [clockKey]);

  // Interpolate while running.
  useEffect(() => {
    if (clockRef.current.status !== "running") return;

    let raf = 0;
    let lastCommit = 0;

    const loop = () => {
      const now = Date.now() + offsetRef.current;
      const next = remainingFor(clockRef.current, now);
      const stamp = performance.now();

      if (stamp - lastCommit >= MATCH_CLOCK_TICK_MS) {
        lastCommit = stamp;
        setRemaining(next);
      }

      if (next <= 0) {
        if (!completedRef.current) {
          completedRef.current = true;
          setRemaining(0);
          onCompleteRef.current?.();
        }
        return;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clockKey]);

  return useMemo(
    () => ({
      remainingMs: remaining,
      offsetMs: offset,
      isLow: isLowTime(clock, remaining),
      isExpired: isExpiredFor(clock, remaining),
    }),
    [remaining, offset, clock]
  );
}
