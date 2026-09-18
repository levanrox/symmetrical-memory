"use client";

import React, { useEffect, useState } from "react";
import { MatchClock } from "@/components/match/MatchClock";
import { useRingClockController } from "@/hooks/useRingClockController";
import type { RingClock } from "@/lib/matchClock";

interface MatchTimerProps {
  ringId: string;
  clock: RingClock;
  serverNow?: number;
  /** Ring-level pause (the category assignment is paused). */
  isPaused?: boolean;
}

const PRESETS = [
  { sec: 90, label: "1:30" },
  { sec: 120, label: "2:00" },
  { sec: 180, label: "3:00" },
];

/**
 * The clock for tatamis that are running without a digital draw. It reads and
 * writes the same persisted clock as the scoring desk and the arena screen, so
 * switching modes never changes what the audience sees.
 */
export default function MatchTimer({ ringId, clock: initialClock, serverNow, isPaused }: MatchTimerProps) {
  const clock = useRingClockController({
    ringId,
    initialClock,
    initialServerNow: serverNow,
  });

  const [isPressing, setIsPressing] = useState(false);
  const [longPressRef, setLongPressRef] = React.useState<ReturnType<typeof setTimeout> | null>(null);
  const hasLongPressed = React.useRef(false);

  useEffect(() => {
    return () => {
      if (longPressRef) clearTimeout(longPressRef);
    };
  }, [longPressRef]);

  const { remainingMs, running, pending, isLow, isExpired } = clock;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    hasLongPressed.current = false;
    setIsPressing(true);
    if (longPressRef) clearTimeout(longPressRef);

    const timeout = setTimeout(() => {
      hasLongPressed.current = true;
      setIsPressing(false);
      if (typeof window !== "undefined" && window.navigator?.vibrate) {
        window.navigator.vibrate(60);
      }
      void clock.reset();
    }, 850);
    setLongPressRef(timeout);
  };

  const handlePointerUp = () => {
    if (longPressRef) clearTimeout(longPressRef);
    setIsPressing(false);
    if (!hasLongPressed.current && !isPaused) {
      void clock.toggle();
    }
    hasLongPressed.current = false;
  };

  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-[#E1DDCF] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E1DDCF] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[#68645A]">timer</span>
          <h3 className="font-label-caps text-label-caps tracking-widest text-[#68645A]">MATCH CLOCK</h3>
          <span
            aria-live="polite"
            className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
              isPaused
                ? "bg-[#F7E4E1] text-[#8E2E27]"
                : running
                  ? "bg-[#E3F6F0] text-[#0B7C63]"
                  : "bg-[#ECE9DF] text-[#68645A]"
            }`}
          >
            {isPaused ? "Tatami paused" : running ? "Running" : clock.clock.status === "finished" ? "Time up" : "Ready"}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-[#E1DDCF] bg-[#F5F3EC] p-1">
          {PRESETS.map(({ sec, label }) => (
            <button
              key={sec}
              type="button"
              onClick={() => void clock.applyDuration(sec * 1000)}
              disabled={pending}
              className={`min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                clock.clock.durationMs === sec * 1000 ? "bg-[#0E9C7C] text-white" : "text-[#68645A] hover:text-[#1B1815]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 px-4 py-6 sm:px-5">
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            if (longPressRef) clearTimeout(longPressRef);
            setIsPressing(false);
          }}
          className={`cursor-pointer rounded-xl px-4 py-2 transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
            isPressing ? "scale-95" : ""
          } ${isLow ? "bg-[#FFF7E6]" : isExpired ? "bg-[#FDECEA]" : ""}`}
          title="Tap to start or pause · hold to reset"
        >
          <MatchClock remainingMs={remainingMs} status={clock.clock.status} size="mod" tone="light" />
        </button>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void clock.toggle()}
            disabled={pending || isPaused}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-xl px-5 py-2.5 text-xs font-black uppercase text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
              running ? "bg-amber-500 text-black" : "bg-[#0E9C7C]"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{running ? "pause" : "play_arrow"}</span>
            {running ? "Pause" : "Start"}
          </button>

          <button
            type="button"
            onClick={() => void clock.reset()}
            disabled={pending}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#E1DDCF] bg-white px-4 py-2.5 text-xs font-bold text-[#1B1815] transition-colors hover:bg-[#F5F3EC] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            Reset
          </button>
        </div>

        {clock.error && (
          <p role="alert" className="text-xs font-semibold text-[#DC2626]">
            {clock.error}
          </p>
        )}

        <p className="text-center text-[11px] text-[#8C877C]">
          Tap the clock to start or pause, hold it to reset. Both devices read this same clock.
        </p>
      </div>
    </section>
  );
}
