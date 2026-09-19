"use client";

import React from "react";

interface Props {
  tatamiName: string;
  categoryName: string;
  boutNo?: number | null;
  roundName?: string | null;
  tournamentName?: string | null;
  connection: "live" | "reconnecting";
  chromeVisible: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  scale: number;
  onSetScale: (scale: number) => void;
}

export function BoutHeader({
  tatamiName,
  categoryName,
  boutNo,
  roundName,
  tournamentName,
  connection,
  chromeVisible,
  isFullscreen,
  onToggleFullscreen,
  scale,
  onSetScale,
}: Props) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[#2A2622] bg-[#191715] px-[max(1.25rem,env(safe-area-inset-left))] py-[clamp(0.5rem,1.4vmin,1rem)]">
      <div className="flex min-w-0 items-center gap-[clamp(0.6rem,1.6vmin,1.4rem)]">
        <span
          className="font-scoreboard shrink-0 rounded-lg bg-[#0E9C7C] px-[clamp(0.6rem,1.6vmin,1.1rem)] py-[clamp(0.15rem,0.6vmin,0.4rem)] font-black uppercase text-white"
          style={{ fontSize: "clamp(0.85rem,2vmin,1.6rem)" }}
        >
          {tatamiName}
        </span>

        <div className="min-w-0">
          <h1
            className="truncate font-black uppercase tracking-tight text-[#F7F5F0]"
            style={{ fontSize: "clamp(1rem,2.6vmin,2.4rem)" }}
          >
            {categoryName}
          </h1>
          <p
            className="truncate font-bold uppercase tracking-[0.14em] text-[#8C877C]"
            style={{ fontSize: "clamp(0.6rem,1.3vmin,1rem)" }}
          >
            {boutNo ? `Bout ${boutNo}${roundName ? ` · ${roundName}` : ""}` : "Between bouts"}
            {tournamentName ? ` · ${tournamentName}` : ""}
          </p>
        </div>
      </div>

      <div
        className={`group/fullscreen flex shrink-0 items-center gap-[clamp(0.4rem,1.2vmin,1rem)] transition-opacity duration-300 ${
          chromeVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <span
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-bold uppercase tracking-wider ${
            connection === "live"
              ? "border-[#0E9C7C]/40 bg-[#0E9C7C]/10 text-[#0E9C7C]"
              : "border-amber-600/40 bg-amber-500/10 text-amber-400"
          }`}
          style={{ fontSize: "clamp(0.6rem,1.1vmin,0.85rem)" }}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${connection === "live" ? "bg-[#0E9C7C]" : "bg-amber-400"}`} />
          {connection === "live" ? "Connected" : "Reconnecting"}
        </span>

        <select
          value={scale}
          onChange={(e) => onSetScale(parseFloat(e.target.value))}
          className={`flex min-h-[44px] cursor-pointer items-center rounded-lg border border-[#2A2622] bg-[#221F1C] px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-[#E7E5E4] transition-all hover:border-[#0E9C7C] hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
            isFullscreen ? "opacity-0 group-hover/fullscreen:opacity-100" : "opacity-100"
          }`}
          title="Adjust arena display scale"
        >
          <option value="0.85">85% (Compact)</option>
          <option value="1">100% (Standard)</option>
          <option value="1.15">115% (Large TV)</option>
          <option value="1.3">130% (Arena Wall)</option>
        </select>

        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-pressed={isFullscreen}
          // In fullscreen the arena should be nothing but the bout, so the way
          // out stays invisible until the pointer reaches this corner (Esc and
          // F both work too). Outside fullscreen it is a normal button.
          className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#2A2622] bg-[#221F1C] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#E7E5E4] transition-all hover:border-[#0E9C7C] hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
            isFullscreen ? "opacity-0 group-hover/fullscreen:opacity-100" : "opacity-100"
          }`}
          title={isFullscreen ? "Exit full screen (Esc)" : "Full screen (F)"}
        >
          <span className="material-symbols-outlined text-[18px]">
            {isFullscreen ? "fullscreen_exit" : "fullscreen"}
          </span>
          {isFullscreen ? "Esc to exit" : "Full screen"}
        </button>
      </div>
    </header>
  );
}
