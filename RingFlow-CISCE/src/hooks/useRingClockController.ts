"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  adjustRingClock,
  finishRingClock,
  getRingClock,
  pauseRingClock,
  resetRingClock,
  setRingClockDuration,
  setRingSidesSwapped,
  startRingClock,
  type ClockResult,
} from "@/actions/clock";
import { type RingClock } from "@/lib/matchClock";
import { useMatchClock, type ClockSyncSample } from "@/hooks/useMatchClock";

function keyOf(clock: RingClock) {
  return `${clock.status}|${clock.durationMs}|${clock.accumulatedMs}|${clock.startedAtMs ?? 0}`;
}

export interface RingClockController {
  clock: RingClock;
  remainingMs: number;
  /** Measured difference between this device's clock and the server's. */
  offsetMs: number;
  isLow: boolean;
  isExpired: boolean;
  running: boolean;
  pending: boolean;
  error: string | null;
  sidesSwapped: boolean;
  toggle: () => Promise<void>;
  pause: () => Promise<void>;
  reset: (durationMs?: number) => Promise<void>;
  applyDuration: (durationMs: number) => Promise<void>;
  adjust: (deltaMs: number) => Promise<void>;
  finish: () => Promise<void>;
  setSwapped: (swapped: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * One controller for every surface that can run a tatami clock: the digital
 * scoring pad, the quick-counter view, and (read-only) the arena display.
 * Every mutation goes through the server, which is what keeps two screens in
 * lockstep instead of each device counting for itself.
 */
export function useRingClockController(options: {
  ringId: string;
  initialClock: RingClock;
  initialServerNow?: number;
  /** Local times for that server stamp, when the caller measured the request. */
  initialServerNowSentAt?: number;
  initialServerNowReceivedAt?: number;
  initialSidesSwapped?: boolean;
  onElapsed?: () => void;
}): RingClockController {
  const {
    ringId,
    initialClock,
    initialServerNow,
    initialServerNowSentAt,
    initialServerNowReceivedAt,
    initialSidesSwapped,
    onElapsed,
  } = options;

  const buildSync = (serverNow?: number): ClockSyncSample | null =>
    typeof serverNow === "number"
      ? { serverNow, sentAt: initialServerNowSentAt, receivedAt: initialServerNowReceivedAt }
      : null;

  const [clock, setClock] = useState<RingClock>(initialClock);
  const [sidesSwapped, setSidesSwappedState] = useState(Boolean(initialSidesSwapped));
  const [sync, setSync] = useState<ClockSyncSample | null>(() => buildSync(initialServerNow));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastWriteRef = useRef(0);
  const adoptedKeyRef = useRef(keyOf(initialClock));
  const sentAtRef = useRef(Date.now());
  const onElapsedRef = useRef(onElapsed);
  onElapsedRef.current = onElapsed;

  // Adopt fresh server state, but never let a slow refresh undo a fresh action.
  useEffect(() => {
    const nextKey = keyOf(initialClock);
    if (nextKey === adoptedKeyRef.current) return;
    if (Date.now() - lastWriteRef.current < 1500) return;
    adoptedKeyRef.current = nextKey;
    setClock(initialClock);
    if (typeof initialSidesSwapped === "boolean") {
      setSidesSwappedState(initialSidesSwapped);
    }
  }, [initialClock, initialSidesSwapped]);

  // The clock and the TV sides travel together, but a swap can happen while the
  // clock itself is unchanged (paused, idle), so sides are adopted on their own
  // too — whoever flipped them, this desk ends up showing the same thing.
  useEffect(() => {
    if (typeof initialSidesSwapped !== "boolean") return;
    if (Date.now() - lastWriteRef.current < 1500) return;
    setSidesSwappedState((prev) => (prev === initialSidesSwapped ? prev : initialSidesSwapped));
  }, [initialSidesSwapped]);

  // Every server stamp is a fresh timing sample, whether or not the clock state
  // itself changed — a running clock keeps the same state for minutes.
  useEffect(() => {
    if (typeof initialServerNow !== "number") return;
    setSync({
      serverNow: initialServerNow,
      sentAt: initialServerNowSentAt,
      receivedAt: initialServerNowReceivedAt,
    });
  }, [initialServerNow, initialServerNowSentAt, initialServerNowReceivedAt]);

  const applyResult = useCallback((result: ClockResult | undefined, receivedAt = Date.now()) => {
    if (!result) return;
    if (!result.success) {
      setError(result.error ?? "Clock update failed");
      return;
    }
    setError(null);
    if (result.clock) {
      adoptedKeyRef.current = keyOf(result.clock);
      setClock(result.clock);
    }
    setSync({ serverNow: result.serverNow, sentAt: sentAtRef.current, receivedAt });
    if (typeof result.sidesSwapped === "boolean") {
      setSidesSwappedState(result.sidesSwapped);
    }
  }, []);

  const run = useCallback(
    async (
      action: () => Promise<ClockResult>,
      optimistic?: (current: RingClock) => RingClock
    ) => {
      sentAtRef.current = Date.now();
      lastWriteRef.current = Date.now();
      setPending(true);
      if (optimistic) {
        setClock((current) => optimistic(current));
      }
      try {
        const result = await action();
        applyResult(result, Date.now());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Clock update failed");
      } finally {
        setPending(false);
      }
    },
    [applyResult]
  );

  const { remainingMs, offsetMs, isLow, isExpired } = useMatchClock(clock, sync, {
    onComplete: () => {
      onElapsedRef.current?.();
      void finishRingClock(ringId)
        .then(applyResult)
        .catch(() => {});
    },
  });

  const toggle = useCallback(async () => {
    if (clock.status === "running") {
      const elapsed = clock.durationMs - remainingMs;
      await run(
        () => pauseRingClock(ringId, Math.round(elapsed)),
        (current) => ({
          status: "paused",
          durationMs: current.durationMs,
          accumulatedMs: Math.round(elapsed),
          startedAtMs: null,
        })
      );
      return;
    }

    // Starting fresh from a finished clock, or resuming a paused one.
    const elapsed = clock.status === "finished" ? 0 : clock.durationMs - remainingMs;
    await run(
      () => startRingClock(ringId, Math.round(elapsed)),
      (current) => ({
        status: "running",
        durationMs: current.durationMs,
        accumulatedMs: Math.round(elapsed),
        startedAtMs: Date.now(),
      })
    );
  }, [clock, remainingMs, ringId, run]);

  const reset = useCallback(
    async (durationMs?: number) => {
      await run(
        () => resetRingClock(ringId, durationMs),
        (current) => ({
          status: "idle",
          durationMs: durationMs && durationMs > 0 ? durationMs : current.durationMs,
          accumulatedMs: 0,
          startedAtMs: null,
        })
      );
    },
    [ringId, run]
  );

  const applyDuration = useCallback(
    async (durationMs: number) => {
      await run(
        () => setRingClockDuration(ringId, durationMs),
        (current) => ({
          status: current.status === "finished" ? "idle" : current.status,
          durationMs,
          accumulatedMs: Math.min(current.accumulatedMs, durationMs),
          startedAtMs: current.status === "running" ? Date.now() : null,
        })
      );
    },
    [ringId, run]
  );

  const adjust = useCallback(
    async (deltaMs: number) => {
      const elapsed = clock.durationMs - remainingMs;
      const nextElapsed = Math.max(0, Math.min(elapsed + deltaMs, clock.durationMs));
      await run(
        () => adjustRingClock(ringId, deltaMs),
        (current) => ({
          status: current.status === "finished" ? "paused" : current.status,
          durationMs: current.durationMs,
          accumulatedMs: Math.round(nextElapsed),
          startedAtMs: current.status === "running" ? Date.now() : null,
        })
      );
    },
    [clock, remainingMs, ringId, run]
  );

  const finish = useCallback(async () => {
    await run(
      () => finishRingClock(ringId),
      (current) => ({
        status: "finished",
        durationMs: current.durationMs,
        accumulatedMs: current.durationMs,
        startedAtMs: null,
      })
    );
  }, [ringId, run]);

  const setSwapped = useCallback(
    async (swapped: boolean) => {
      setSidesSwappedState(swapped);
      await run(() => setRingSidesSwapped(ringId, swapped));
    },
    [ringId, run]
  );

  const refresh = useCallback(async () => {
    sentAtRef.current = Date.now();
    const result = await getRingClock(ringId);
    applyResult(result, Date.now());
  }, [ringId, applyResult]);

  return {
    clock,
    remainingMs,
    offsetMs,
    isLow,
    isExpired,
    running: clock.status === "running",
    pending,
    error,
    sidesSwapped,
    toggle,
    pause: async () => {
      if (clock.status === "running") {
        await toggle();
      }
    },
    reset,
    applyDuration,
    adjust,
    finish,
    setSwapped,
    refresh,
  };
}
