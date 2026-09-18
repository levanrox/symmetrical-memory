"use client";

import React from "react";

export interface FighterView {
  id?: string | null;
  name: string;
  school?: string;
  chestNumber?: string | null;
}

const ACCENTS = {
  AKA: { badge: "#DC2626", glow: "rgba(220,38,38,0.14)", ring: "#DC2626" },
  AO: { badge: "#2563EB", glow: "rgba(37,99,235,0.14)", ring: "#2563EB" },
};

const PENALTY_LABELS = ["1", "2", "3", "HC", "H"];

interface Props {
  side: "AKA" | "AO";
  fighter: FighterView;
  score: number;
  penalties: number;
  hasSenshu: boolean;
  isWinner: boolean;
  /** Right-hand column: text and score sit against the outside edge. */
  mirrored?: boolean;
}

/**
 * One half of the arena screen. Sized in vmin so a 1080p TV and a 4K wall
 * panel present the same composition, and readable from the back of the hall.
 */
export function FighterPanel({
  side,
  fighter,
  score,
  penalties,
  hasSenshu,
  isWinner,
  mirrored = false,
}: Props) {
  const accent = ACCENTS[side];
  const hasFighter = Boolean(fighter?.name && fighter.name !== "TBD");
  const name = hasFighter ? fighter.name : "Waiting";

  return (
    <section
      aria-label={`${side === "AKA" ? "Aka, red" : "Ao, blue"} competitor`}
      className={`flex min-h-0 min-w-0 flex-col gap-[clamp(0.5rem,1.6vmin,1.75rem)] p-[clamp(0.9rem,2.2vmin,2.25rem)] ${
        mirrored ? "items-end text-right" : "items-start text-left"
      }`}
      style={{
        background: `linear-gradient(${mirrored ? "to left" : "to right"}, ${accent.glow}, transparent 58%)`,
      }}
    >
      <div className={`flex flex-wrap items-center gap-[clamp(0.35rem,1vmin,0.85rem)] ${mirrored ? "justify-end" : ""}`}>
        <span
          className="rounded-lg font-black uppercase tracking-[0.14em] text-white"
          style={{
            backgroundColor: accent.badge,
            fontSize: "clamp(0.85rem,2.1vmin,1.9rem)",
            padding: "clamp(0.2rem,0.75vmin,0.5rem) clamp(0.6rem,1.7vmin,1.4rem)",
          }}
        >
          {side}
        </span>

        {fighter?.chestNumber && (
          <span
            className="font-bold text-[#8C877C]"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "clamp(0.8rem,1.8vmin,1.5rem)",
            }}
          >
            #{fighter.chestNumber}
          </span>
        )}

        {hasSenshu && (
          <span
            className="rounded-lg bg-amber-400 font-black uppercase tracking-wider text-amber-950"
            style={{ fontSize: "clamp(0.7rem,1.5vmin,1.2rem)", padding: "clamp(0.1rem,0.5vmin,0.3rem) clamp(0.4rem,1vmin,0.8rem)" }}
          >
            ★ Senshu
          </span>
        )}

        {isWinner && (
          <span
            className="rounded-lg bg-[#10B981] font-black uppercase tracking-wider text-[#062E22]"
            style={{ fontSize: "clamp(0.7rem,1.5vmin,1.2rem)", padding: "clamp(0.1rem,0.5vmin,0.3rem) clamp(0.4rem,1vmin,0.8rem)" }}
          >
            Winner
          </span>
        )}
      </div>

      {/* Name block sits directly under the badges; the arena reads it first. */}
      <div className="min-w-0 max-w-full">
        <h2
          className={`font-black uppercase leading-[1.02] tracking-tight ${
            hasFighter ? "text-[#F7F5F0]" : "text-[#57534E]"
          }`}
          style={{
            fontSize: "clamp(1.75rem, min(6.6vmin, 11vh), 7rem)",
            overflowWrap: "break-word",
            textWrap: "balance",
          }}
        >
          {name}
        </h2>
        {fighter?.school && (
          <p
            className="mt-[clamp(0.2rem,0.7vmin,0.6rem)] font-bold uppercase tracking-[0.1em] text-[#8C877C]"
            style={{ fontSize: "clamp(0.7rem,1.9vmin,1.6rem)", overflowWrap: "break-word" }}
          >
            {fighter.school}
          </p>
        )}
      </div>

      {/* Score anchors the bottom of the frame and carries the most weight. */}
      <div className={`mt-auto flex w-full flex-col gap-[clamp(0.3rem,0.9vmin,0.75rem)] ${mirrored ? "items-end" : "items-start"}`}>
        <div
          className="flex w-full items-center justify-center rounded-2xl border-4 bg-[#191715]"
          style={{
            borderColor: accent.ring,
            height: "clamp(4.5rem, min(20vmin, 30vh), 20rem)",
            boxShadow: isWinner ? "inset 0 0 0 6px rgba(16,185,129,0.55)" : undefined,
          }}
        >
          <span
            className="leading-none"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 900,
              fontVariantNumeric: "tabular-nums",
              fontSize: "clamp(3.5rem, min(16vmin, 24vh), 16rem)",
              color: isWinner ? "#10B981" : accent.badge,
            }}
          >
            {score}
          </span>
        </div>

        <div className={`flex items-center gap-[clamp(0.4rem,1vmin,1rem)] ${mirrored ? "flex-row-reverse" : ""}`}>
          <span
            className="font-black uppercase tracking-[0.2em] text-[#8C877C]"
            style={{ fontSize: "clamp(0.55rem,1.15vmin,1rem)" }}
          >
            Warnings
          </span>
          <div className="flex gap-[clamp(0.2rem,0.6vmin,0.5rem)]">
            {PENALTY_LABELS.map((label, index) => {
              const active = penalties >= index + 1;
              return (
                <span
                  key={label}
                  className="flex items-center justify-center rounded-md border font-black"
                  style={{
                    width: "clamp(1.4rem,3.2vmin,2.8rem)",
                    height: "clamp(1.4rem,3.2vmin,2.8rem)",
                    fontSize: "clamp(0.6rem,1.4vmin,1.15rem)",
                    backgroundColor: active ? (index === 4 ? "#DC2626" : "#D97706") : "#191715",
                    borderColor: active ? "transparent" : "#2A2622",
                    color: active ? "#FFFFFF" : "#57534E",
                  }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
