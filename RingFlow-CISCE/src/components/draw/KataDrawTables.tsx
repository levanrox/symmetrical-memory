"use client";

import React, { useMemo } from "react";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";
import type {
  KataDrawTableView,
  KataTableBout,
} from "@/lib/draws/kataTableView";

interface Props {
  kataDraw: KataDrawTableView;
  /** Every match in the category; pool bouts drive the group tables. */
  matches: BracketMatchView[];
  categoryName: string;
  tournamentSize?: number;
  onSelectMatch?: (match: BracketMatchView) => void;
  activeMatchId?: string | null;
  /** Public athlete search: that athlete's rows are emphasised. */
  highlightAthleteId?: string | null;
  onDownloadPdf?: () => void;
  isDownloadingPdf?: boolean;
  /** When true, omits the top header so the parent modal header can be unified */
  hideHeader?: boolean;
}

const FORMAT_LABEL: Record<KataDrawTableView["format"], string> = {
  GROUPS_THEN_ELIMINATION: "Groups + elimination",
  ROUND_ROBIN: "Round robin",
};

const RANKING_LABEL: Record<KataDrawTableView["rankingMethod"], string> = {
  WKF_VICTORY_POINTS: "Victory points",
  TOTAL_SCORE: "Total score",
};

/** 21 -> "21", 21.5 -> "21.5". */
function fmtScore(value: number | null): string {
  if (value == null) return "–";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function BoutCell({
  bout,
  onSelectMatch,
  matchById,
  activeMatchId,
}: {
  bout: KataTableBout;
  onSelectMatch?: (match: BracketMatchView) => void;
  matchById: Map<string, BracketMatchView>;
  activeMatchId?: string | null;
}) {
  const isLive = bout.matchId === activeMatchId;
  const decided = bout.won != null;
  const tone = decided
    ? bout.won
      ? "font-black text-emerald-700"
      : "font-semibold text-[#8C877C]"
    : "text-[#3D3A33]";
  const title = `Bout #${bout.matchNo} vs ${bout.opponentName} · ${bout.roundLabel}`;

  const inner = (
    <span className={`flex flex-col items-center gap-0.5 ${tone}`}>
      <span className="font-data-mono text-[13px] tabular-nums">{fmtScore(bout.score)}</span>
      {decided && (
        <span
          className={`text-[9px] font-black uppercase tracking-wide ${
            bout.won ? "text-emerald-600" : "text-[#B8B3A4]"
          }`}
        >
          {bout.won ? "W" : "L"}
        </span>
      )}
      {isLive && (
        <span className="rounded bg-amber-100 px-1 text-[8px] font-black uppercase text-amber-800 animate-pulse">
          Live
        </span>
      )}
    </span>
  );

  if (!onSelectMatch) {
    return (
      <td title={title} className="border-b border-[#EDEAE0] px-1 py-2 text-center align-middle">
        {inner}
      </td>
    );
  }

  const target = matchById.get(bout.matchId);
  return (
    <td className="border-b border-[#EDEAE0] p-0.5 text-center align-middle">
      <button
        type="button"
        title={`${title} — load on scoring desk`}
        onClick={() => target && onSelectMatch(target)}
        className="flex min-h-[44px] w-full cursor-pointer flex-col items-center justify-center rounded-lg px-1 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
      >
        {inner}
      </button>
    </td>
  );
}

function GroupTable({
  group,
  kataDraw,
  matchById,
  onSelectMatch,
  activeMatchId,
  highlightAthleteId,
}: {
  group: KataDrawTableView["groups"][number];
  kataDraw: KataDrawTableView;
  matchById: Map<string, BracketMatchView>;
  onSelectMatch?: (match: BracketMatchView) => void;
  activeMatchId?: string | null;
  highlightAthleteId?: string | null;
}) {
  // Bout columns, in bout-number order across the group.
  const boutColumns = useMemo(() => {
    const seen = new Map<number, string>();
    for (const m of group.members) {
      for (const b of m.bouts) {
        if (!seen.has(b.matchNo)) seen.set(b.matchNo, b.matchId);
      }
    }
    return [...seen.entries()]
      .sort(([a], [b]) => a - b)
      .map(([matchNo, matchId]) => ({ matchNo, matchId }));
  }, [group]);

  const boutByMatchNo = useMemo(() => {
    const map = new Map<string, Map<number, KataTableBout>>();
    for (const m of group.members) {
      const per = new Map<number, KataTableBout>();
      for (const b of m.bouts) per.set(b.matchNo, b);
      map.set(m.id, per);
    }
    return map;
  }, [group]);

  return (
    <section className="overflow-hidden rounded-xl border border-[#E1DDCF] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#E1DDCF] bg-[#FAF9F5] px-4 py-2.5">
        <h3 className="text-xs font-black uppercase tracking-wider text-[#0E9C7C]">
          {group.name}
        </h3>
        <span className="rounded border border-[#E1DDCF] bg-white px-2 py-0.5 text-[10px] font-bold text-[#8C877C]">
          {group.members.length} {group.members.length === 1 ? "athlete" : "athletes"}
          {kataDraw.format === "GROUPS_THEN_ELIMINATION" &&
            ` · top ${kataDraw.advancePerGroup} qualify`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-[#0E9C7C] bg-white">
              <th className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                #
              </th>
              <th className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Participant
              </th>
              {boutColumns.map(({ matchNo, matchId }) => {
                const sample = matchById.get(matchId);
                return (
                  <th
                    key={matchNo}
                    title={sample ? `Bout #${matchNo} · ${sample.roundName}` : `Bout #${matchNo}`}
                    className="px-1 py-2 text-center font-data-mono text-[10px] font-black text-[#8C877C]"
                  >
                    #{matchNo}
                  </th>
                );
              })}
              <th
                title="Victory points — 3 per bout won"
                className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-wider text-[#8C877C]"
              >
                Pts
              </th>
              <th className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Total
              </th>
              <th className="px-3 py-2 text-center text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Rank
              </th>
            </tr>
          </thead>
          <tbody>
            {group.members.map((m, i) => {
              const highlighted = highlightAthleteId === m.id;
              const per = boutByMatchNo.get(m.id) ?? new Map<number, KataTableBout>();
              return (
                <tr
                  key={m.id}
                  className={`${
                    highlighted
                      ? "bg-red-50/60"
                      : m.qualified
                        ? "bg-emerald-50/40"
                        : i % 2 === 1
                          ? "bg-[#FAF9F5]/60"
                          : "bg-white"
                  }`}
                >
                  <td className="border-b border-[#EDEAE0] px-3 py-2 font-data-mono text-xs font-bold text-[#8C877C]">
                    {i + 1}
                  </td>
                  <td className="border-b border-[#EDEAE0] px-3 py-2">
                    <p
                      className={`whitespace-nowrap text-[13px] ${
                        highlighted ? "font-black text-[#B91C1C]" : "font-bold text-[#1B1815]"
                      }`}
                    >
                      {m.name}
                      {m.chestNumber ? (
                        <span className="ml-1.5 font-data-mono text-[10px] font-bold text-[#8C877C]">
                          #{m.chestNumber}
                        </span>
                      ) : null}
                      {m.qualified && (
                        <span
                          title="Qualifies for the finals"
                          className="ml-1.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white"
                        >
                          Q
                        </span>
                      )}
                    </p>
                    {m.school && (
                      <p className="whitespace-nowrap text-[10px] text-[#68645A]">{m.school}</p>
                    )}
                  </td>
                  {boutColumns.map(({ matchNo }) => {
                    const bout = per.get(matchNo);
                    return bout ? (
                      <BoutCell
                        key={matchNo}
                        bout={bout}
                        onSelectMatch={onSelectMatch}
                        matchById={matchById}
                        activeMatchId={activeMatchId}
                      />
                    ) : (
                      <td
                        key={matchNo}
                        className="border-b border-[#EDEAE0] px-1 py-2 text-center text-[#D5D0C0]"
                      >
                        ·
                      </td>
                    );
                  })}
                  <td className="border-b border-[#EDEAE0] px-2 py-2 text-center font-data-mono text-[13px] font-black tabular-nums text-[#1B1815]">
                    {m.points}
                  </td>
                  <td className="border-b border-[#EDEAE0] px-2 py-2 text-center font-data-mono text-[13px] font-bold tabular-nums text-[#3D3A33]">
                    {fmtScore(m.totalScore)}
                  </td>
                  <td className="border-b border-[#EDEAE0] px-3 py-2 text-center">
                    <span
                      className={`inline-flex min-w-[26px] items-center justify-center rounded-lg px-1.5 py-0.5 font-data-mono text-xs font-black ${
                        m.rank === 1
                          ? "bg-amber-100 text-amber-900"
                          : m.qualified
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-[#F5F3EC] text-[#68645A]"
                      }`}
                    >
                      {m.rank}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FinalsTable({
  matches,
  scoresByMatch,
  onSelectMatch,
  activeMatchId,
}: {
  matches: BracketMatchView[];
  scoresByMatch: KataDrawTableView["scoresByMatch"];
  onSelectMatch?: (match: BracketMatchView) => void;
  activeMatchId?: string | null;
}) {
  const finals = useMemo(
    () =>
      matches
        .filter((m) => m.bracketType !== "POOL")
        .sort((a, b) => a.matchNo - b.matchNo),
    [matches]
  );

  if (finals.length === 0) return null;

  const pendingCount = finals.filter((m) => !m.aka.id || !m.ao.id).length;

  const renderFighter = (m: BracketMatchView, side: "AKA" | "AO") => {
    const f = side === "AKA" ? m.aka : m.ao;
    const won = Boolean(m.winnerId && f.id && m.winnerId === f.id);
    const score = scoresByMatch[m.matchId]?.[side === "AKA" ? "aka" : "ao"] ?? null;
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${side === "AKA" ? "bg-[#E4483C]" : "bg-[#1D4ED8]"}`}
          title={side === "AKA" ? "AKA (Red)" : "AO (Blue)"}
        />
        <div className="min-w-0">
          <p
            className={`truncate text-[13px] ${
              f.id ? (won ? "font-black text-emerald-800" : "font-bold text-[#1B1815]") : "font-semibold italic text-[#8C877C]"
            }`}
          >
            {f.displayName}
          </p>
          {f.school && <p className="truncate text-[10px] text-[#68645A]">{f.school}</p>}
        </div>
        {score != null && (
          <span className="ml-auto shrink-0 font-data-mono text-[13px] font-black tabular-nums text-[#3D3A33]">
            {fmtScore(score)}
          </span>
        )}
      </div>
    );
  };

  return (
    <section className="overflow-hidden rounded-xl border border-[#E1DDCF] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#E1DDCF] bg-[#FAF9F5] px-4 py-2.5">
        <h3 className="text-xs font-black uppercase tracking-wider text-[#0E9C7C]">Finals</h3>
        <span className="text-[10px] font-bold text-[#8C877C]">
          {pendingCount > 0
            ? `${pendingCount} slot${pendingCount === 1 ? "" : "s"} fill in when the groups are decided`
            : "Bracket complete"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-[#0E9C7C] bg-white">
              <th className="px-3 py-2 font-data-mono text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Bout
              </th>
              <th className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Round
              </th>
              <th className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Fighter A
              </th>
              <th className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Fighter B
              </th>
              <th className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {finals.map((m) => {
              const isLive = m.matchId === activeMatchId;
              const decided = m.status === "CONFIRMED" || m.winnerId != null;
              const row = (
                <>
                  <td className="border-b border-[#EDEAE0] px-3 py-2.5 font-data-mono text-xs font-bold text-[#8C877C]">
                    #{m.matchNo}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#EDEAE0] px-3 py-2.5 text-xs font-bold text-[#3D3A33]">
                    {m.roundName}
                  </td>
                  <td className="min-w-[160px] border-b border-[#EDEAE0] px-3 py-2.5">
                    {renderFighter(m, "AKA")}
                  </td>
                  <td className="min-w-[160px] border-b border-[#EDEAE0] px-3 py-2.5">
                    {renderFighter(m, "AO")}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#EDEAE0] px-3 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                        isLive
                          ? "bg-amber-100 text-amber-800 animate-pulse"
                          : decided
                            ? "bg-[#EAE7DC] text-[#78746B]"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isLive ? "Live" : decided ? "Done" : m.status}
                    </span>
                  </td>
                </>
              );

              return onSelectMatch ? (
                <tr
                  key={m.matchId}
                  onClick={() => onSelectMatch(m)}
                  className={`cursor-pointer transition-colors hover:bg-emerald-50/50 ${
                    isLive ? "bg-emerald-50/40" : ""
                  }`}
                >
                  {row}
                </tr>
              ) : (
                <tr key={m.matchId} className={isLive ? "bg-emerald-50/40" : ""}>
                  {row}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function KataDrawTables({
  kataDraw,
  matches,
  categoryName,
  tournamentSize,
  onSelectMatch,
  activeMatchId,
  highlightAthleteId,
  onDownloadPdf,
  isDownloadingPdf,
  hideHeader = false,
}: Props) {
  const matchById = useMemo(() => new Map(matches.map((m) => [m.matchId, m])), [matches]);
  const athleteCount = useMemo(
    () => kataDraw.groups.reduce((n, g) => n + g.members.length, 0),
    [kataDraw]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#E1DDCF] bg-[#FAF9F5]">
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3 border-b border-[#E1DDCF] bg-white px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E1DDCF] bg-[#FAF9F5] px-2.5 py-1 text-xs font-bold text-[#1B1815]">
              <span className="material-symbols-outlined text-[15px] text-[#0E9C7C]">table_chart</span>
              {tournamentSize ? `${tournamentSize} Competitors` : `${athleteCount} Competitors`}
            </span>
            <span className="hidden truncate text-xs font-medium text-[#68645A] sm:inline">
              {FORMAT_LABEL[kataDraw.format]} · {kataDraw.groups.length}{" "}
              {kataDraw.groups.length === 1 ? "group" : "groups"} · ranked by{" "}
              {RANKING_LABEL[kataDraw.rankingMethod].toLowerCase()}
            </span>
          </div>

          {onDownloadPdf && (
            <button
              onClick={onDownloadPdf}
              disabled={isDownloadingPdf}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[#0E9C7C] px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-all hover:bg-[#0B7C63] disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
              {isDownloadingPdf ? "Generating…" : "PDF"}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 space-y-5 overflow-auto p-4 sm:p-6">
        <p className="sr-only">{categoryName} group stage tables</p>
        {kataDraw.groups.map((group) => (
          <GroupTable
            key={group.id}
            group={group}
            kataDraw={kataDraw}
            matchById={matchById}
            onSelectMatch={onSelectMatch}
            activeMatchId={activeMatchId}
            highlightAthleteId={highlightAthleteId}
          />
        ))}

        {kataDraw.format === "GROUPS_THEN_ELIMINATION" && (
          <FinalsTable
            matches={matches}
            scoresByMatch={kataDraw.scoresByMatch}
            onSelectMatch={onSelectMatch}
            activeMatchId={activeMatchId}
          />
        )}

        <p className="pb-2 text-center text-[10px] text-[#8C877C]">
          {onSelectMatch
            ? "Tap a bout score to load it on the scoring desk"
            : "Scores update live as bouts are decided"}
        </p>
      </div>
    </div>
  );
}
