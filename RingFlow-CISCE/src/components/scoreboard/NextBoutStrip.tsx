"use client";

import React from "react";

export interface NextBoutView {
  matchNo: number;
  roundName: string;
  aka: { name: string };
  ao: { name: string };
}

interface Props {
  nextBout: NextBoutView | null;
  nextCategoryName?: string | null;
}

/**
 * What the arena should know is coming. The corners are named explicitly: AKA
 * and AO are the words officials and the audience use, so the strip says which
 * fighter is which rather than leaving it to be guessed.
 */
export function NextBoutStrip({ nextBout, nextCategoryName }: Props) {
  const cornerLabel = (text: string, color: string) => (
    <span
      className="shrink-0 rounded font-black uppercase tracking-wider text-white"
      style={{
        backgroundColor: color,
        fontSize: "clamp(0.55rem,1.05vmin,0.8rem)",
        padding: "clamp(0.1rem,0.35vmin,0.2rem) clamp(0.3rem,0.8vmin,0.6rem)",
      }}
    >
      {text}
    </span>
  );

  const fighterName = (name?: string) => (
    <span
      className="truncate font-bold uppercase tracking-wide text-[#F7F5F0]"
      style={{ fontSize: "clamp(0.75rem,1.7vmin,1.5rem)" }}
    >
      {name || "TBD"}
    </span>
  );

  return (
    <footer className="flex flex-wrap items-center gap-[clamp(0.4rem,1.2vmin,1rem)] border-t border-[#2A2622] bg-[#191715] px-[max(1.25rem,env(safe-area-inset-left))] py-[clamp(0.4rem,1.2vmin,0.8rem)]">
      <span
        className="shrink-0 rounded-md bg-[#2A2622] px-2 py-0.5 font-black uppercase tracking-[0.18em] text-[#8C877C]"
        style={{ fontSize: "clamp(0.55rem,1.1vmin,0.85rem)" }}
      >
        Next bout
      </span>

      {nextBout ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-[clamp(0.5rem,1.4vmin,1.25rem)] gap-y-1">
          <span className="flex min-w-0 items-center gap-[clamp(0.3rem,0.9vmin,0.7rem)]">
            {cornerLabel("Aka", "#DC2626")}
            {fighterName(nextBout.aka?.name)}
          </span>

          <span
            className="shrink-0 font-black uppercase text-[#57534E]"
            style={{ fontSize: "clamp(0.6rem,1.2vmin,1rem)" }}
          >
            vs
          </span>

          <span className="flex min-w-0 items-center gap-[clamp(0.3rem,0.9vmin,0.7rem)]">
            {cornerLabel("Ao", "#2563EB")}
            {fighterName(nextBout.ao?.name)}
          </span>

          <span
            className="shrink-0 font-bold uppercase tracking-[0.14em] text-[#8C877C]"
            style={{ fontSize: "clamp(0.55rem,1.1vmin,0.85rem)" }}
          >
            Bout {nextBout.matchNo}
          </span>
        </div>
      ) : (
        <span
          className="truncate font-bold uppercase tracking-wide text-[#8C877C]"
          style={{ fontSize: "clamp(0.7rem,1.5vmin,1.3rem)" }}
        >
          {nextCategoryName ? `Next category · ${nextCategoryName}` : "No further bouts queued"}
        </span>
      )}
    </footer>
  );
}
