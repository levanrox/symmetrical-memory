"use client";

import React from "react";
import { MatchClock } from "@/components/match/MatchClock";
import type { ClockStatus } from "@/lib/matchClock";

interface Props {
  remainingMs: number;
  status: ClockStatus;
  boutDecided: boolean;
  offsetMs?: number;
}

const STATUS_LABEL: Record<ClockStatus, string> = {
  idle: "Ready",
  running: "Live",
  paused: "Paused",
  finished: "Time up",
};

/** The centre of the arena screen: one clock, one state word. */
export function ClockStage({ remainingMs, status, boutDecided, offsetMs }: Props) {
  const label = boutDecided ? "Decided" : STATUS_LABEL[status];
  const tone = boutDecided
    ? "border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981]"
    : status === "running"
      ? "border-[#0E9C7C]/50 bg-[#0E9C7C]/10 text-[#0E9C7C]"
      : status === "paused"
        ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
        : status === "finished"
          ? "border-red-600/50 bg-red-600/10 text-red-400"
          : "border-[#2A2622] bg-[#191715] text-[#8C877C]";

  return (
    <div className="flex min-h-0 flex-col items-center justify-center gap-[clamp(0.5rem,1.8vmin,1.75rem)] border-y border-[#2A2622] bg-[#141210] px-[clamp(0.75rem,2vw,2.5rem)] py-[clamp(0.75rem,3vmin,2.5rem)] lg:border-x lg:border-y-0">
      <MatchClock remainingMs={remainingMs} status={status} size="tv" tone="dark" offsetMs={offsetMs} />

      <span
        className={`rounded-lg border font-black uppercase tracking-[0.22em] ${tone}`}
        style={{
          fontSize: "clamp(0.65rem,1.5vmin,1.25rem)",
          padding: "clamp(0.15rem,0.6vmin,0.4rem) clamp(0.5rem,1.5vmin,1.1rem)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
