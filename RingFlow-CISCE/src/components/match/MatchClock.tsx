"use client";

import React from "react";
import { formatClockParts, type ClockStatus } from "@/lib/matchClock";

type Size = "tv" | "mod";
type Tone = "dark" | "light";

interface Props {
  remainingMs: number;
  status: ClockStatus;
  /** `tv` scales with the screen; `mod` is a fixed desk size. */
  size?: Size;
  /** `dark` for the arena surface, `light` for the cream app surfaces. */
  tone?: Tone;
  showMillis?: boolean;
  className?: string;
  /** Exposed for diagnostics: how far this device's clock is from the server's. */
  offsetMs?: number;
}

// Scaled against the smaller viewport axis for width, but capped by height so a
// short, wide screen never clips the clock.
const TV_SIZES = {
  main: "clamp(4.5rem, min(15vmin, 26vh), 15rem)",
  fraction: "clamp(1.5rem, min(5vmin, 8.6vh), 5rem)",
  gap: "clamp(0.25rem, 0.7vmin, 0.75rem)",
};

const TV_TONES: Record<Tone, Record<string, { main: string; fraction: string }>> = {
  dark: {
    running: { main: "#F5E97A", fraction: "#8C877C" },
    paused: { main: "#E8E0C4", fraction: "#8C877C" },
    idle: { main: "#6E6A63", fraction: "#5A564F" },
    low: { main: "#FBBF24", fraction: "#B98837" },
    expired: { main: "#EF4444", fraction: "#9B5148" },
  },
  light: {
    running: { main: "#1B1815", fraction: "#8C877C" },
    paused: { main: "#3D3A33", fraction: "#8C877C" },
    idle: { main: "#8C877C", fraction: "#A19C90" },
    low: { main: "#B45309", fraction: "#A16207" },
    expired: { main: "#DC2626", fraction: "#B91C1C" },
  },
};

const MOD_TONES: Record<Tone, { running: string; low: string; expired: string; fraction: string }> = {
  dark: {
    running: "text-white",
    low: "text-amber-400",
    expired: "text-red-500",
    fraction: "text-[#8C877C]",
  },
  light: {
    running: "text-[#1B1815]",
    low: "text-[#B45309]",
    expired: "text-[#DC2626]",
    fraction: "text-[#8C877C]",
  },
};

export function MatchClock({
  remainingMs,
  status,
  size = "mod",
  tone = "light",
  showMillis = true,
  className = "",
  offsetMs,
}: Props) {
  const { minutes, seconds, millis } = formatClockParts(remainingMs);

  const expired = status === "finished" || remainingMs <= 0;
  const low = !expired && status === "running" && remainingMs <= 15_000;
  const state = expired ? "expired" : low ? "low" : status;

  if (size === "tv") {
    const palette = TV_TONES[tone][state] ?? TV_TONES[tone].idle;

    return (
      <span
        role="timer"
        data-clock-offset={offsetMs !== undefined ? Math.round(offsetMs) : undefined}
        aria-label={`${Number(minutes)} minutes ${Number(seconds)} seconds remaining`}
        className={`inline-flex items-baseline leading-none ${className}`}
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 900,
          gap: TV_SIZES.gap,
          letterSpacing: "-0.02em",
        }}
      >
        <span style={{ fontSize: TV_SIZES.main, color: palette.main }}>{minutes}</span>
        <span style={{ fontSize: TV_SIZES.main, color: palette.main, opacity: 0.5 }}>:</span>
        <span style={{ fontSize: TV_SIZES.main, color: palette.main }}>{seconds}</span>
        {showMillis && (
          <span style={{ fontSize: TV_SIZES.fraction, color: palette.fraction, fontWeight: 700 }}>
            .{millis}
          </span>
        )}
      </span>
    );
  }

  const palette = MOD_TONES[tone];
  const mainTone = expired ? palette.expired : low ? palette.low : status === "running" || status === "paused" ? palette.running : tone === "dark" ? "text-neutral-400" : "text-[#68645A]";

  return (
    <span
      role="timer"
      data-clock-offset={offsetMs !== undefined ? Math.round(offsetMs) : undefined}
      aria-label={`${Number(minutes)} minutes ${Number(seconds)} seconds remaining`}
      className={`inline-flex items-baseline gap-0.5 font-data-mono font-black tabular-nums leading-none ${mainTone} ${className}`}
    >
      <span className="text-3xl sm:text-4xl">{minutes}</span>
      <span className="text-3xl opacity-40 sm:text-4xl">:</span>
      <span className="text-3xl sm:text-4xl">{seconds}</span>
      {showMillis && (
        <span className={`text-sm font-bold sm:text-base ${palette.fraction}`}>.{millis}</span>
      )}
    </span>
  );
}
