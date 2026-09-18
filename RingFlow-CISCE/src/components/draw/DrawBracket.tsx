"use client";

import React, { useState, useMemo } from "react";
import type { BracketMatchView } from "@/actions/draws";

interface Props {
  matches: BracketMatchView[];
  categoryName: string;
  tournamentSize?: number;
  onDownloadPdf?: () => void;
  isDownloadingPdf?: boolean;
  onSelectMatch?: (match: BracketMatchView) => void;
  activeMatchId?: string | null;
  compact?: boolean;
  /** When set (public athlete search), that athlete is emphasised and the rest dimmed. */
  highlightAthleteId?: string | null;
}

export function DrawBracket({
  matches,
  categoryName,
  tournamentSize,
  onDownloadPdf,
  isDownloadingPdf,
  onSelectMatch,
  activeMatchId,
  compact,
  highlightAthleteId,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [selectedMatch, setSelectedMatch] = useState<BracketMatchView | null>(null);

  // Group matches by round
  const sortedRounds = useMemo(() => {
    const main = matches.filter((m) => m.bracketType === "MAIN");
    const roundsMap = new Map<number, BracketMatchView[]>();

    for (const m of main) {
      const list = roundsMap.get(m.roundNo) ?? [];
      list.push(m);
      roundsMap.set(m.roundNo, list);
    }

    return Array.from(roundsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNo, list]) => ({
        roundNo,
        roundName: list[0]?.roundName || `Round ${roundNo}`,
        matches: list.sort((a, b) => a.matchNo - b.matchNo),
      }));
  }, [matches]);

  const handleZoomIn = () => setZoom((z) => Math.min(1.6, z + 0.15));
  const handleZoomOut = () => setZoom((z) => Math.max(0.65, z - 0.15));
  const handleResetZoom = () => setZoom(1);

  return (
    <div className="flex flex-col h-full bg-[#FAF9F5] rounded-xl border border-[#E1DDCF] overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-[#E1DDCF]">
        <div>
          <h3 className="font-bold text-base text-[#1B1815] tracking-tight">
            {categoryName}
          </h3>
          <p className="text-xs text-[#68645A]">
            {tournamentSize ? `${tournamentSize}-Competitor Bracket` : "Tournament Bracket"} · Single Elimination
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center bg-[#F5F3EC] rounded-lg p-1 border border-[#E1DDCF]">
            <button
              onClick={handleZoomOut}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center p-1 text-[#68645A] hover:text-[#1B1815] rounded hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              title="Zoom Out"
            >
              <span className="material-symbols-outlined text-[18px]">zoom_out</span>
            </button>
            <span className="px-2 text-xs font-mono font-medium text-[#3D3A33]">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center p-1 text-[#68645A] hover:text-[#1B1815] rounded hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              title="Zoom In"
            >
              <span className="material-symbols-outlined text-[18px]">zoom_in</span>
            </button>
            <button
              onClick={handleResetZoom}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center p-1 ml-1 text-[#68645A] hover:text-[#1B1815] rounded hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              title="Reset Zoom"
            >
              <span className="material-symbols-outlined text-[18px]">restart_alt</span>
            </button>
          </div>

          {/* Download PDF button */}
          {onDownloadPdf && (
            <button
              onClick={onDownloadPdf}
              disabled={isDownloadingPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white rounded-lg text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
              {isDownloadingPdf ? "Generating..." : "Download Draw PDF"}
            </button>
          )}
        </div>
      </div>

      {/* Bracket Canvas */}
      <div className="flex-1 overflow-auto p-6 relative">
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
          className="flex gap-10 items-stretch min-w-max transition-transform duration-150 ease-out"
        >
          {sortedRounds.map((round) => (
            <div key={round.roundNo} className="flex flex-col min-w-[240px]">
              {/* Round Header */}
              <div className="mb-4 pb-2 border-b-2 border-[#0E9C7C] flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider text-[#0E9C7C]">
                  {round.roundName}
                </span>
                <span className="text-[10px] font-bold text-[#8C877C] bg-white px-2 py-0.5 rounded border border-[#E1DDCF]">
                  {round.matches.length} {round.matches.length === 1 ? "Bout" : "Bouts"}
                </span>
              </div>

              {/* Matches Column */}
              <div className="flex flex-col justify-around flex-1 gap-6">
                {round.matches.map((match) => {
                  const isDecided = match.status === "CONFIRMED" || match.winnerId != null;
                  const akaWon = match.winnerId && match.aka.id && match.winnerId === match.aka.id;
                  const aoWon = match.winnerId && match.ao.id && match.winnerId === match.ao.id;
                  const isCurrentBout = activeMatchId === match.matchId;
                  const akaHighlighted = Boolean(highlightAthleteId) && match.aka.id === highlightAthleteId;
                  const aoHighlighted = Boolean(highlightAthleteId) && match.ao.id === highlightAthleteId;
                  const containsHighlight = akaHighlighted || aoHighlighted;

                  return (
                    <div
                      key={match.matchId}
                      onClick={() => {
                        setSelectedMatch(match);
                        if (onSelectMatch) onSelectMatch(match);
                      }}
                      className={`relative bg-white rounded-xl border transition-all cursor-pointer hover:shadow-lg ${
                        containsHighlight
                          ? "border-[#DC2626] ring-2 ring-[#DC2626] shadow-md"
                          : highlightAthleteId
                          ? "border-[#E1DDCF] opacity-55 hover:opacity-90"
                          : isCurrentBout
                          ? "border-[#0E9C7C] ring-2 ring-[#0E9C7C] shadow-md bg-emerald-50/15"
                          : selectedMatch?.matchId === match.matchId
                          ? "border-[#0E9C7C] ring-2 ring-[#0E9C7C]/30 shadow-sm"
                          : "border-[#E1DDCF] hover:border-[#0E9C7C]"
                      }`}
                    >
                      {/* Match # Pill */}
                      <div className={`flex items-center justify-between px-3 py-1.5 border-b border-[#E1DDCF] rounded-t-xl text-[10px] font-bold ${
                        isCurrentBout ? "bg-[#0E9C7C] text-white" : "bg-[#FAF9F5] text-[#68645A]"
                      }`}>
                        <span className="flex items-center gap-1">
                          {isCurrentBout && <span className="material-symbols-outlined text-[13px]">sports_martial_arts</span>}
                          Bout #{match.matchNo}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                            isCurrentBout
                              ? "bg-white text-[#0E9C7C]"
                              : isDecided
                              ? "bg-emerald-50 text-emerald-700 font-bold"
                              : match.status === "LIVE"
                              ? "bg-amber-50 text-amber-700 animate-pulse font-bold"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {isCurrentBout ? "ACTIVE NOW" : isDecided ? "CONFIRMED" : match.status}
                        </span>
                      </div>

                      {/* AKA Athlete Card */}
                      <div
                        className={`flex items-center justify-between p-2.5 border-b border-[#E1DDCF] ${
                          akaWon ? "bg-emerald-50/60 font-bold" : ""
                        } ${akaHighlighted ? "bg-red-50" : ""}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#E4483C] shrink-0" title="AKA (Red)" />
                          <div className="truncate">
                            <p
                              className={`text-xs truncate ${
                                akaHighlighted ? "font-black text-[#B91C1C]" : "font-semibold text-[#1B1815]"
                              }`}
                            >
                              {match.aka.displayName}
                              {akaHighlighted && (
                                <span className="ml-1.5 rounded bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                                  Searched
                                </span>
                              )}
                            </p>
                            {match.aka.school && (
                              <p className="text-[10px] text-[#68645A] truncate">
                                {match.aka.school}
                              </p>
                            )}
                          </div>
                        </div>
                        {akaWon && (
                          <span className="material-symbols-outlined text-emerald-600 text-[18px] shrink-0">
                            check_circle
                          </span>
                        )}
                      </div>

                      {/* AO Athlete Card */}
                      <div
                        className={`flex items-center justify-between p-2.5 rounded-b-xl ${
                          aoWon ? "bg-emerald-50/60 font-bold" : ""
                        } ${aoHighlighted ? "bg-blue-50" : ""}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#1D4ED8] shrink-0" title="AO (Blue)" />
                          <div className="truncate">
                            <p
                              className={`text-xs truncate ${
                                aoHighlighted ? "font-black text-[#1D4ED8]" : "font-semibold text-[#1B1815]"
                              }`}
                            >
                              {match.ao.displayName}
                              {aoHighlighted && (
                                <span className="ml-1.5 rounded bg-[#2563EB] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                                  Searched
                                </span>
                              )}
                            </p>
                            {match.ao.school && (
                              <p className="text-[10px] text-[#68645A] truncate">
                                {match.ao.school}
                              </p>
                            )}
                          </div>
                        </div>
                        {aoWon && (
                          <span className="material-symbols-outlined text-emerald-600 text-[18px] shrink-0">
                            check_circle
                          </span>
                        )}
                      </div>

                      {/* Select & Conduct Action Bar if interactive */}
                      {onSelectMatch && (
                        <div className="p-1.5 bg-[#F5F3EC] border-t border-[#E1DDCF] rounded-b-xl flex items-center justify-between">
                          <span className="text-[9px] text-[#68645A] font-semibold pl-1">
                            {isCurrentBout ? "Loaded in scoring desk" : "Click anywhere to select"}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectMatch(match);
                            }}
                            className={`flex min-h-[36px] items-center gap-1 rounded px-2.5 py-1.5 text-[10px] font-bold cursor-pointer transition-colors shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                              isCurrentBout
                                ? "bg-[#0E9C7C] text-white"
                                : "bg-neutral-800 hover:bg-neutral-900 text-white"
                            }`}
                          >
                            <span className="material-symbols-outlined text-[13px]">sports_martial_arts</span>
                            {isCurrentBout ? "Scoring Now" : isDecided ? "Review / Re-conduct" : "Select Bout"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
