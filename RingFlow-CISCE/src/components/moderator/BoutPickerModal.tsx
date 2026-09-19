"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawBracket } from "@/components/draw/DrawBracket";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";

export interface PickableBout {
  id: string;
  matchNo: number;
  roundName: string;
  status: string;
  isReady: boolean;
  isFinished: boolean;
  aka: { name?: string; school?: string; chestNumber?: string | null };
  ao: { name?: string; school?: string; chestNumber?: string | null };
  akaScore?: number;
  aoScore?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  categoryName: string;
  bouts: PickableBout[];
  drawMatches: BracketMatchView[];
  tournamentSize?: number;
  activeMatchId?: string | null;
  bronzeMedals?: number;
  onSelect: (matchId: string) => void;
}

type StatusFilter = "ready" | "live" | "done" | "all";

/**
 * Names imported from spreadsheets often carry non-breaking spaces, which look
 * identical to a normal space but never match one. Everything is flattened to
 * single ordinary spaces before comparing.
 */
function normalizeText(value: string): string {
  return value.replace(/[\s\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]+/g, " ").trim().toLowerCase();
}

/** Everything a moderator might type: names, chest numbers, clubs, bout or round. */
function haystack(bout: PickableBout): string {
  return normalizeText(
    [
      bout.matchNo,
      `bout ${bout.matchNo}`,
      bout.roundName,
      bout.aka?.name,
      bout.aka?.chestNumber,
      bout.aka?.school,
      bout.ao?.name,
      bout.ao?.chestNumber,
      bout.ao?.school,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * Choosing a bout is a deliberate act, so it gets the whole screen on a laptop
 * and a full-height sheet on a phone. The list answers one question fast:
 * "which bout am I running next?"
 */
export function BoutPickerModal({
  isOpen,
  onClose,
  categoryName,
  bouts,
  drawMatches,
  tournamentSize,
  activeMatchId,
  bronzeMedals = 2,
  onSelect,
}: Props) {
  const [view, setView] = useState<"list" | "tree">("tree");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ready");
  const [roundFilter, setRoundFilter] = useState<string>("all");
  const [activeIndex, setActiveIndex] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const rounds = useMemo(
    () => Array.from(new Set(bouts.map((b) => b.roundName))).sort(),
    [bouts]
  );

  const counts = useMemo(
    () => ({
      ready: bouts.filter((b) => b.isReady && b.status !== "LIVE").length,
      live: bouts.filter((b) => b.status === "LIVE").length,
      done: bouts.filter((b) => b.isFinished).length,
      all: bouts.length,
    }),
    [bouts]
  );

  const filtered = useMemo(() => {
    const needle = normalizeText(query);

    // Typing a search means "find this bout", so it looks across every state
    // rather than hiding a decided bout behind the Ready filter.
    const matches = bouts.filter((bout) => {
      if (needle) return haystack(bout).includes(needle);

      if (statusFilter === "ready" && !(bout.isReady && bout.status !== "LIVE")) return false;
      if (statusFilter === "live" && bout.status !== "LIVE") return false;
      if (statusFilter === "done" && !bout.isFinished) return false;
      if (roundFilter !== "all" && bout.roundName !== roundFilter) return false;
      return true;
    });

    // Ready to run first, then by bout number — the order a moderator works in.
    return matches.sort((a, b) => {
      const rank = (bout: PickableBout) =>
        bout.isReady && bout.status !== "LIVE" ? 0 : bout.status === "LIVE" ? 1 : 2;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return a.matchNo - b.matchNo;
    });
  }, [bouts, query, statusFilter, roundFilter]);

  // Reset the keyboard highlight when the filters change. Done during render —
  // the pattern React documents for "adjust state when something changes" —
  // rather than in an effect, which would cost an extra render pass.
  const filterKey = `${query}|${statusFilter}|${roundFilter}|${view}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setActiveIndex(0);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const bout = filtered[activeIndex];
      if (bout) onSelect(bout.id);
    }
  };

  const handleSelect = useCallback(
    (matchId: string) => {
      onSelect(matchId);
    },
    [onSelect]
  );

  if (!isOpen) return null;

  const statusChip = (value: StatusFilter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setStatusFilter(value)}
      aria-pressed={statusFilter === value}
      className={`flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
        statusFilter === value
          ? "border-[#0E9C7C] bg-[#E3F6F0] text-[#0B7C63]"
          : "border-[#E1DDCF] bg-white text-[#68645A] hover:bg-[#FAF9F5]"
      }`}
    >
      {label}
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
          statusFilter === value ? "bg-[#0E9C7C] text-white" : "bg-[#F5F3EC] text-[#8C877C]"
        }`}
      >
        {counts[value]}
      </span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a bout"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden border border-[#E1DDCF] bg-[#FAF9F5] shadow-2xl outline-none sm:h-[92vh] sm:w-[95vw] sm:max-w-[1600px] sm:rounded-2xl"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E1DDCF] bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black uppercase tracking-wider text-[#1B1815] sm:text-base">
              Choose a bout
            </h2>
            <p className="truncate text-[11px] text-[#68645A] sm:text-xs">
              {categoryName} · {bouts.length} bouts · ↑↓ then Enter, or tap a card
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-[#E1DDCF] bg-[#F5F3EC] p-1">
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                className={`flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                  view === "list" ? "bg-[#0E9C7C] text-white shadow-xs" : "text-[#68645A] hover:text-[#1B1815]"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">format_list_bulleted</span>
                List
              </button>
              <button
                type="button"
                onClick={() => setView("tree")}
                aria-pressed={view === "tree"}
                className={`flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                  view === "tree" ? "bg-[#0E9C7C] text-white shadow-xs" : "text-[#68645A] hover:text-[#1B1815]"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">account_tree</span>
                Bracket
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#E1DDCF] bg-white text-[#68645A] transition-colors hover:bg-[#F5F3EC] hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              aria-label="Close bout picker"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </header>

        {/* Filter / Search Toolbar across both views */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#E1DDCF] bg-white px-4 py-2.5 sm:px-6">
          <div className="relative min-w-[200px] flex-1">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[#8C877C]">
              search
            </span>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                view === "tree"
                  ? "Highlight athlete, school, chest #, or bout # in bracket…"
                  : "Athlete, chest number, club, or bout number…"
              }
              aria-label="Search bouts"
              className="w-full rounded-lg border border-[#E1DDCF] bg-[#FAF9F5] py-2 pl-9 pr-8 text-sm text-[#1B1815] outline-none transition-all focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 placeholder:text-[#8C877C]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8C877C] hover:text-[#1B1815] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>

          {view === "list" ? (
            <div className="flex flex-wrap items-center gap-2">
              {statusChip("ready", "Ready")}
              {statusChip("live", "Live")}
              {statusChip("done", "Done")}
              {statusChip("all", "All")}

              {rounds.length > 1 && (
                <select
                  value={roundFilter}
                  onChange={(e) => setRoundFilter(e.target.value)}
                  aria-label="Filter by round"
                  className="min-h-[38px] cursor-pointer rounded-lg border border-[#E1DDCF] bg-white px-2.5 text-xs font-bold text-[#3D3A33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                >
                  <option value="all">All rounds</option>
                  {rounds.map((round) => (
                    <option key={round} value={round}>
                      {round}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-[#0E9C7C] border border-emerald-200/60">
                <span className="material-symbols-outlined text-[14px]">touch_app</span>
                Tap any bout to load on desk
              </span>
              <div className="hidden sm:flex items-center gap-2 text-[#68645A]">
                {counts.live > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200/60 animate-pulse">
                    {counts.live} Live
                  </span>
                )}
                <span className="text-[#8C877C]">
                  {counts.ready} Ready · {counts.done}/{counts.all} Done
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-2.5 sm:p-4 md:p-5">
          {view === "tree" ? (
            <div className="h-full overflow-hidden rounded-xl border border-[#E1DDCF] bg-white shadow-xs">
              {drawMatches.length > 0 ? (
                <DrawBracket
                  matches={drawMatches}
                  categoryName={categoryName}
                  tournamentSize={tournamentSize}
                  bronzeMedals={bronzeMedals}
                  onSelectMatch={(m) => handleSelect(m.matchId)}
                  activeMatchId={activeMatchId}
                  searchQuery={query}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#68645A]">
                  This category has no generated bracket yet. Switch to the list to pick by bout number.
                </div>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <span className="material-symbols-outlined text-3xl text-[#8C877C]">search_off</span>
              <p className="text-sm font-bold text-[#1B1815]">
                {query
                  ? `Nothing matches “${query.trim()}”`
                  : `No ${statusFilter === "all" ? "" : statusFilter} bouts`}
              </p>
              <p className="max-w-sm text-xs text-[#68645A]">
                {query
                  ? "Try a surname, a chest number, a club, or the bout number."
                  : "Every bout in this category is in another state. Show all bouts to pick one anyway."}
              </p>
              <div className="mt-2 flex gap-2">
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="min-h-[40px] rounded-lg border border-[#E1DDCF] bg-white px-3 text-xs font-bold text-[#3D3A33]"
                  >
                    Clear search
                  </button>
                )}
                {statusFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className="min-h-[40px] rounded-lg bg-[#0E9C7C] px-3 text-xs font-bold text-white"
                  >
                    Show all bouts
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((m, index) => {
                  const isCurrent = m.id === activeMatchId;
                  const isActive = index === activeIndex;
                  const showScore = m.isFinished || m.status === "LIVE";

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelect(m.id)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
                        isCurrent
                          ? "border-[#0E9C7C] bg-[#E3F6F0]"
                          : isActive
                            ? "border-[#0E9C7C]/60 bg-white"
                            : m.isFinished
                              ? "border-[#E1DDCF] bg-[#F5F3EC] text-[#8C877C] hover:border-[#8C877C]"
                              : m.status === "LIVE"
                                ? "border-amber-300 bg-white hover:border-amber-500"
                                : m.isReady
                                  ? "border-blue-300 bg-white hover:border-blue-500"
                                  : "border-[#E1DDCF] bg-white hover:border-[#8C877C]"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-black uppercase tracking-wider text-[#1B1815]">
                          Bout #{m.matchNo}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${
                            isCurrent
                              ? "bg-[#0E9C7C] text-white"
                              : m.isFinished
                                ? "bg-neutral-200 text-neutral-700"
                                : m.status === "LIVE"
                                  ? "bg-amber-100 text-amber-800"
                                  : m.isReady
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {isCurrent ? "On desk" : m.isFinished ? "Done" : m.status}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full bg-[#C0392B]" />
                          <span className="truncate text-sm font-bold text-[#1B1815]">
                            {m.aka?.name || "TBD"}
                          </span>
                        </span>
                        {showScore && (
                          <span className="shrink-0 font-data-mono text-base font-black text-[#C0392B] tabular-nums">
                            {m.akaScore ?? 0}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full bg-[#1D4ED8]" />
                          <span className="truncate text-sm font-bold text-[#1B1815]">
                            {m.ao?.name || "TBD"}
                          </span>
                        </span>
                        {showScore && (
                          <span className="shrink-0 font-data-mono text-base font-black text-[#1D4ED8] tabular-nums">
                            {m.aoScore ?? 0}
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 truncate text-[11px] font-semibold text-[#68645A]">
                        {m.roundName}
                        {m.aka?.chestNumber || m.ao?.chestNumber
                          ? ` · #${m.aka?.chestNumber ?? "—"} vs #${m.ao?.chestNumber ?? "—"}`
                          : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#E1DDCF] bg-white px-4 py-2.5 text-[11px] text-[#68645A] sm:px-6">
          <span>
            Showing {view === "list" ? filtered.length : bouts.length} of {bouts.length} bouts · ↑↓ to move, Enter to
            load, / to search, Esc to close
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg px-3 text-xs font-bold text-[#68645A] transition-colors hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
