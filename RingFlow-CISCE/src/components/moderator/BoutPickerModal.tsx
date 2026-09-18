"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawBracket } from "@/components/draw/DrawBracket";
import type { BracketMatchView } from "@/actions/draws";

export interface PickableBout {
  id: string;
  matchNo: number;
  roundName: string;
  status: string;
  isReady: boolean;
  isFinished: boolean;
  aka: { name?: string };
  ao: { name?: string };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  categoryName: string;
  bouts: PickableBout[];
  drawMatches: BracketMatchView[];
  tournamentSize?: number;
  activeMatchId?: string | null;
  onSelect: (matchId: string) => void;
}

/**
 * Choosing a bout is a deliberate act, so it gets the whole screen on a laptop
 * and a full-height sheet on a phone — the bracket needs room to be readable,
 * and the desk behind it is not needed while choosing.
 */
export function BoutPickerModal({
  isOpen,
  onClose,
  categoryName,
  bouts,
  drawMatches,
  tournamentSize,
  activeMatchId,
  onSelect,
}: Props) {
  const [view, setView] = useState<"tree" | "list">("tree");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const sortedBouts = useMemo(
    () =>
      [...bouts].sort((a, b) => {
        if (a.isReady !== b.isReady) return a.isReady ? -1 : 1;
        return a.matchNo - b.matchNo;
      }),
    [bouts]
  );

  const handleSelect = useCallback(
    (matchId: string) => {
      onSelect(matchId);
    },
    [onSelect]
  );

  if (!isOpen) return null;

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
              {categoryName} · {bouts.length} bouts · pick one to load it into the desk
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-[#E1DDCF] bg-[#F5F3EC] p-1">
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

        <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-5">
          {view === "tree" ? (
            <div className="h-full overflow-hidden rounded-xl border border-[#E1DDCF] bg-white">
              {drawMatches.length > 0 ? (
                <DrawBracket
                  matches={drawMatches}
                  categoryName={categoryName}
                  tournamentSize={tournamentSize}
                  onSelectMatch={(m) => handleSelect(m.matchId)}
                  activeMatchId={activeMatchId}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#68645A]">
                  This category has no generated bracket yet. Switch to the list to pick by bout number.
                </div>
              )}
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {sortedBouts.map((m) => {
                  const isCurrent = m.id === activeMatchId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelect(m.id)}
                      className={`rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
                        isCurrent
                          ? "border-[#0E9C7C] bg-[#E3F6F0]"
                          : m.isFinished
                            ? "border-[#E1DDCF] bg-[#F5F3EC] text-[#8C877C] hover:border-[#8C877C]"
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
                          {isCurrent ? "On desk" : m.status}
                        </span>
                      </div>

                      <p className="truncate text-sm font-bold text-[#1B1815]">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#DC2626] align-middle" />
                        {m.aka?.name || "TBD"}
                      </p>
                      <p className="truncate text-sm font-bold text-[#1B1815]">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#2563EB] align-middle" />
                        {m.ao?.name || "TBD"}
                      </p>
                      <p className="mt-1.5 truncate text-[11px] font-semibold text-[#68645A]">
                        {m.roundName}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#E1DDCF] bg-white px-4 py-2.5 text-[11px] text-[#68645A] sm:px-6">
          <span>Tap a bout to load it. Esc closes this window.</span>
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
