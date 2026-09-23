"use client";

/**
 * KataBoutConsole (P5) — the moderator's kata workflow for the active bout.
 *
 * Shown by the tatami console when the active bout belongs to a kata
 * category. Sections, in bout order:
 *   1. Kata choice entry (AKA/AO number + live name lookup -> setBoutKata,
 *      repetition warnings surfaced clearly).
 *   2. Live judge tally (per-seat rows with implied vote arrows; empty seats
 *      get tap-to-type manual entry -> submitManualScore).
 *   3. Decision preview (computeKataBoutDecision; HANTEI picker on a full tie).
 *   4. Confirm winner (confirmKataResult) — sticky above the phone's bottom
 *      nav, static on desktop.
 *
 * The tally refreshes live: judge-score broadcasts carry this ring's id, so
 * the shared `useLiveEvents` feed refetches the tally as marks arrive.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  computeKataBoutDecision,
  confirmKataResult,
  getKataBoutTally,
  setBoutKata,
  submitManualScore,
} from "@/actions/judge";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { getKataName } from "@/engine/rules-engine/rulesets/kata-list";
import { scoreToTenths } from "@/lib/judge/scores";
import {
  buildSeatTally,
  countCountedVotes,
  decisionMethodLabel,
  formatDecisionLine,
  formatKataMark,
  type SeatTallyView,
} from "@/lib/judge/tally";

export interface KataConsoleMatch {
  id: string;
  matchNo: number;
  status: string;
  akaKataNumber: number | null;
  aoKataNumber: number | null;
  winnerSide: string | null;
  aka: { id: string | null; name: string };
  ao: { id: string | null; name: string };
}

interface KataBoutConsoleProps {
  ringId: string;
  match: KataConsoleMatch;
  categoryName: string;
  /** Light reload (kata choice saved). */
  onRefresh: () => void;
  /** Bout confirmed: bump the category match count and move on. */
  onBoutCompleted: () => void;
}

type DecisionState =
  | { kind: "loading" }
  | { kind: "waiting" }
  | {
      kind: "ready";
      winner: "AKA" | "AO";
      akaVotes: number;
      aoVotes: number;
      akaTotal: number;
      aoTotal: number;
      method: string;
      judgesCounted: number;
    }
  | { kind: "tie"; akaVotes: number; aoVotes: number; judgesCounted: number; error: string }
  | { kind: "error"; error: string };

function parseKataInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

export default function KataBoutConsole({
  ringId,
  match,
  categoryName,
  onRefresh,
  onBoutCompleted,
}: KataBoutConsoleProps) {
  const [tally, setTally] = useState<SeatTallyView[] | null>(null);
  const [panelSize, setPanelSize] = useState(5);
  const [decision, setDecision] = useState<DecisionState>({ kind: "loading" });

  // Kata choice form
  const kataSaved = match.akaKataNumber != null && match.aoKataNumber != null;
  const [kataFormOpen, setKataFormOpen] = useState(!kataSaved);
  const [akaKataInput, setAkaKataInput] = useState(
    match.akaKataNumber != null ? String(match.akaKataNumber) : ""
  );
  const [aoKataInput, setAoKataInput] = useState(
    match.aoKataNumber != null ? String(match.aoKataNumber) : ""
  );
  const [kataWarnings, setKataWarnings] = useState<string[]>([]);
  const [kataError, setKataError] = useState<string | null>(null);
  const [savingKata, setSavingKata] = useState(false);

  // Manual score entry
  const [editingSeat, setEditingSeat] = useState<number | null>(null);
  const [manualAka, setManualAka] = useState("");
  const [manualAo, setManualAo] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [savingManual, setSavingManual] = useState(false);

  // Confirm
  const [hantei, setHantei] = useState<"AKA" | "AO" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    winnerSide: "AKA" | "AO";
    method: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const refreshTally = useCallback(async () => {
    try {
      const t = await getKataBoutTally(match.id);
      setPanelSize(t.panelSize);
      const seats = buildSeatTally(t.seats);
      setTally(seats);
      const counted = countCountedVotes(seats);
      if (counted === 0) {
        setDecision({ kind: "waiting" });
        return;
      }
      const res = await computeKataBoutDecision(match.id);
      if (res.success) {
        setDecision({
          kind: "ready",
          winner: res.decision.winner,
          akaVotes: res.decision.akaVotes,
          aoVotes: res.decision.aoVotes,
          akaTotal: res.decision.akaTotal,
          aoTotal: res.decision.aoTotal,
          method: res.decision.method,
          judgesCounted: res.decision.judgesCounted,
        });
      } else {
        // Votes AND total points are tied (a no-vote bout is handled above as
        // "waiting"): the moderator must decide — HANTEI.
        const akaVotes = seats.filter((s) => s.vote === "AKA").length;
        const aoVotes = seats.filter((s) => s.vote === "AO").length;
        setDecision({
          kind: "tie",
          akaVotes,
          aoVotes,
          judgesCounted: counted,
          error: res.error ?? "Votes and total scores are tied: a moderator decision is required.",
        });
      }
    } catch (e) {
      setDecision({
        kind: "error",
        error: e instanceof Error ? e.message : "Could not load the judge tally.",
      });
    }
  }, [match.id]);

  useEffect(() => {
    void refreshTally();
  }, [refreshTally]);

  // Judge scores, approvals and manual entries all broadcast with this
  // ring's id — refetch the tally (debounced) as marks arrive.
  useLiveEvents(
    { ringId },
    () => {
      void refreshTally();
    },
    { debounceMs: 500 }
  );

  const countedVotes = useMemo(
    () => (tally ? countCountedVotes(tally) : 0),
    [tally]
  );

  // ------------------------------------------------------------------
  // Kata choice
  // ------------------------------------------------------------------
  const akaParsed = parseKataInput(akaKataInput);
  const aoParsed = parseKataInput(aoKataInput);
  const akaName =
    akaParsed != null ? (getKataName(akaParsed) ?? null) : undefined;
  const aoName = aoParsed != null ? (getKataName(aoParsed) ?? null) : undefined;

  const handleSaveKata = async () => {
    setKataError(null);
    setKataWarnings([]);
    if (akaParsed == null || akaParsed < 1 || akaParsed > 102) {
      setKataError("AKA kata must be a number from 1 to 102.");
      return;
    }
    if (aoParsed == null || aoParsed < 1 || aoParsed > 102) {
      setKataError("AO kata must be a number from 1 to 102.");
      return;
    }
    setSavingKata(true);
    try {
      const res = await setBoutKata(match.id, akaParsed, aoParsed);
      setKataWarnings(res.warnings);
      showToast("Kata choice saved.");
      setKataFormOpen(false);
      onRefresh();
    } catch (e) {
      setKataError(e instanceof Error ? e.message : "Could not save the kata choice.");
    } finally {
      setSavingKata(false);
    }
  };

  // ------------------------------------------------------------------
  // Manual score entry
  // ------------------------------------------------------------------
  const openManualEntry = (seat: SeatTallyView) => {
    setEditingSeat(seat.seatNumber);
    setManualAka(seat.aka ? formatKataMark(seat.aka.tenths) : "");
    setManualAo(seat.ao ? formatKataMark(seat.ao.tenths) : "");
    setManualError(null);
  };

  const handleSaveManual = async () => {
    if (editingSeat == null) return;
    setManualError(null);
    const sides: Array<["AKA" | "AO", string]> = [
      ["AKA", manualAka],
      ["AO", manualAo],
    ];
    const writes: Array<{ side: "AKA" | "AO"; tenths: number }> = [];
    for (const [side, raw] of sides) {
      const t = raw.trim();
      if (t === "") continue;
      try {
        writes.push({ side, tenths: scoreToTenths(t) });
      } catch {
        setManualError(
          `${side} mark must be 5.0–10.0 in 0.1 steps (e.g. 8.5).`
        );
        return;
      }
    }
    if (writes.length === 0) {
      setManualError("Enter at least one mark.");
      return;
    }
    setSavingManual(true);
    try {
      for (const w of writes) {
        await submitManualScore(match.id, editingSeat, w.side, w.tenths / 10);
      }
      setEditingSeat(null);
      showToast(`Seat ${editingSeat} score saved.`);
      await refreshTally();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "Could not save the score.");
    } finally {
      setSavingManual(false);
    }
  };

  // ------------------------------------------------------------------
  // Confirm
  // ------------------------------------------------------------------
  const confirmSide: "AKA" | "AO" | null =
    decision.kind === "ready" ? decision.winner : decision.kind === "tie" ? hantei : null;

  const handleConfirm = async () => {
    setConfirmError(null);
    if (decision.kind === "tie" && !hantei) {
      setConfirmError("Votes and points are tied — pick the winner (HANTEI) first.");
      return;
    }
    if (!confirmSide) return;
    setConfirming(true);
    try {
      const res = await confirmKataResult(
        match.id,
        decision.kind === "tie" ? confirmSide : undefined
      );
      setConfirmed({
        winnerSide: res.winnerSide as "AKA" | "AO",
        method: res.decisionMethod,
      });
      showToast("Result confirmed.");
      onBoutCompleted();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Could not confirm the result.");
    } finally {
      setConfirming(false);
    }
  };

  const isConfirmed = match.status === "CONFIRMED" || confirmed != null;
  const winnerName =
    (confirmed?.winnerSide ?? (match.winnerSide as "AKA" | "AO" | null)) === "AKA"
      ? match.aka.name
      : match.ao.name;

  return (
    <section aria-label="Kata bout console" className="space-y-4">
      {toast && (
        <div className="fixed top-20 left-1/2 z-50 flex max-w-sm -translate-x-1/2 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-lg animate-fadeIn">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          {toast}
        </div>
      )}

      {/* Bout header */}
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
            Kata · Bout #{match.matchNo} · {categoryName}
          </p>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
              match.status === "CONFIRMED"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-sky-100 text-sky-800"
            }`}
          >
            {match.status}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#DC2626]">AKA</p>
            <p className="truncate text-base font-extrabold text-on-surface sm:text-lg">
              {match.aka.name}
            </p>
          </div>
          <span className="text-xs font-black text-on-surface-variant">VS</span>
          <div className="min-w-0 text-right">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#2563EB]">AO</p>
            <p className="truncate text-base font-extrabold text-on-surface sm:text-lg">
              {match.ao.name}
            </p>
          </div>
        </div>
      </div>

      {/* Kata choice */}
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setKataFormOpen((v) => !v)}
          className="flex min-h-[52px] w-full items-center justify-between gap-2 px-4 text-left cursor-pointer hover:bg-surface-container-low transition-colors"
          aria-expanded={kataFormOpen}
        >
          <span className="flex items-center gap-2 text-sm font-extrabold text-on-surface">
            <span className="material-symbols-outlined text-[20px] text-secondary">sports_martial_arts</span>
            Kata choice
          </span>
          {kataSaved && !kataFormOpen ? (
            <span className="truncate text-xs font-bold text-on-surface-variant">
              <span className="text-[#DC2626]">#{match.akaKataNumber} {getKataName(match.akaKataNumber!)}</span>
              {" · "}
              <span className="text-[#2563EB]">#{match.aoKataNumber} {getKataName(match.aoKataNumber!)}</span>
            </span>
          ) : null}
          <span
            className="material-symbols-outlined text-[20px] text-on-surface-variant transition-transform"
            style={{ transform: kataFormOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            expand_more
          </span>
        </button>

        {kataFormOpen && (
          <div className="space-y-3 border-t border-outline-variant px-4 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  { side: "AKA" as const, value: akaKataInput, set: setAkaKataInput, name: akaName, color: "text-[#DC2626]", ring: "focus:ring-[#DC2626]" },
                  { side: "AO" as const, value: aoKataInput, set: setAoKataInput, name: aoName, color: "text-[#2563EB]", ring: "focus:ring-[#2563EB]" },
                ]
              ).map(({ side, value, set, name, color, ring }) => (
                <label key={side} className="block">
                  <span className={`text-xs font-black uppercase tracking-wider ${color}`}>
                    {side} kata number
                  </span>
                  <input
                    value={value}
                    onChange={(e) => set(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    placeholder="e.g. 25"
                    className={`mt-1 min-h-[52px] w-full rounded-xl border border-outline-variant bg-white px-4 text-xl font-extrabold text-on-surface focus:outline-none focus:ring-2 ${ring}`}
                  />
                  <span className="mt-1 block min-h-[20px] text-sm font-semibold">
                    {value.trim() === "" ? (
                      <span className="text-on-surface-variant">Enter 1–102</span>
                    ) : name ? (
                      <span className="text-on-surface">{name}</span>
                    ) : (
                      <span className="text-error">Not on the official list (1–102)</span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            {kataError && (
              <p className="rounded-xl border border-error/30 bg-error/5 px-3 py-2.5 text-sm font-semibold text-error">
                {kataError}
              </p>
            )}
            {kataWarnings.length > 0 && (
              <div className="space-y-1.5">
                {kataWarnings.map((w, i) => (
                  <p
                    key={i}
                    className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900"
                  >
                    <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
                    {w}
                  </p>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleSaveKata}
              disabled={savingKata || isConfirmed}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-sm font-black uppercase tracking-wide text-white transition-colors hover:bg-secondary/90 disabled:opacity-50 cursor-pointer active:scale-[0.98]"
            >
              {savingKata ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <span className="material-symbols-outlined text-[20px]">save</span>
              )}
              Save kata choice
            </button>
          </div>
        )}
      </div>

      {/* Live judge tally */}
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm overflow-hidden">
        <div className="flex min-h-[52px] items-center justify-between gap-2 px-4">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-on-surface">
            <span className="material-symbols-outlined text-[20px] text-secondary">how_to_vote</span>
            Judge tally
          </h3>
          <span className="text-xs font-bold text-on-surface-variant">
            {countedVotes} of {panelSize} judges in
          </span>
        </div>

        <div className="border-t border-outline-variant">
          {tally == null ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-container" />
              ))}
            </div>
          ) : (
            tally.map((seat) => {
              const isEditing = editingSeat === seat.seatNumber;
              return (
                <div key={seat.seatNumber} className="border-b border-outline-variant last:border-b-0">
                  <button
                    type="button"
                    disabled={isConfirmed}
                    onClick={() => (isEditing ? setEditingSeat(null) : openManualEntry(seat))}
                    className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-container-low cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                    aria-expanded={isEditing}
                    aria-label={isConfirmed ? `Seat ${seat.seatNumber}: scores locked (bout confirmed)` : `Seat ${seat.seatNumber}: enter or correct scores`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container text-sm font-black text-on-surface">
                      {seat.seatNumber}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-on-surface">
                        {seat.judgeName ?? "Empty seat"}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs font-semibold">
                        <span className={seat.aka ? "text-[#DC2626]" : "text-on-surface-variant"}>
                          AKA {seat.aka ? formatKataMark(seat.aka.tenths) : "—"}
                          {seat.aka?.isManual && (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-black text-amber-800">M</span>
                          )}
                        </span>
                        <span className="text-on-surface-variant">·</span>
                        <span className={seat.ao ? "text-[#2563EB]" : "text-on-surface-variant"}>
                          AO {seat.ao ? formatKataMark(seat.ao.tenths) : "—"}
                          {seat.ao?.isManual && (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-black text-amber-800">M</span>
                          )}
                        </span>
                      </span>
                    </span>
                    {seat.vote === "AKA" && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-red-50 px-2 py-1 text-[11px] font-black text-[#DC2626]">
                        <span className="material-symbols-outlined text-[14px]">arrow_back</span>AKA
                      </span>
                    )}
                    {seat.vote === "AO" && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-[#2563EB]">
                        AO<span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </span>
                    )}
                    {seat.vote === "EVEN" && (
                      <span className="shrink-0 rounded-full bg-surface-container px-2 py-1 text-[11px] font-black text-on-surface-variant">
                        EVEN
                      </span>
                    )}
                    {seat.vote == null && (
                      <span className="shrink-0 rounded-full bg-surface-container px-2 py-1 text-[11px] font-bold text-on-surface-variant">
                        {seat.aka || seat.ao ? "half vote" : "no score"}
                      </span>
                    )}
                    <span className="material-symbols-outlined shrink-0 text-[18px] text-on-surface-variant">
                      {isEditing ? "expand_less" : "edit"}
                    </span>
                  </button>

                  {isEditing && (
                    <div className="space-y-3 bg-surface-container-low px-4 py-4">
                      <p className="text-xs font-bold text-on-surface-variant">
                        Manual entry — Seat {seat.seatNumber}
                        {seat.judgeName ? ` (${seat.judgeName})` : " (empty seat)"}. Leave a
                        side blank to keep its current mark.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {(
                          [
                            { side: "AKA", value: manualAka, set: setManualAka },
                            { side: "AO", value: manualAo, set: setManualAo },
                          ] as const
                        ).map(({ side, value, set }) => (
                          <label key={side} className="block">
                            <span className="text-xs font-black uppercase tracking-wider text-on-surface-variant">
                              {side}
                            </span>
                            <input
                              value={value}
                              onChange={(e) => set(e.target.value)}
                              inputMode="decimal"
                              placeholder="8.5"
                              className="mt-1 min-h-[52px] w-full rounded-xl border border-outline-variant bg-white px-4 text-xl font-extrabold text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                            />
                          </label>
                        ))}
                      </div>
                      {manualError && (
                        <p className="rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-sm font-semibold text-error">
                          {manualError}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingSeat(null)}
                          className="min-h-[48px] flex-1 rounded-xl border border-outline-variant bg-white px-4 text-sm font-bold text-on-surface cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveManual}
                          disabled={savingManual}
                          className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50 cursor-pointer"
                        >
                          {savingManual ? (
                            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          ) : null}
                          Save score
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Decision preview */}
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-on-surface">
          <span className="material-symbols-outlined text-[20px] text-secondary">emoji_events</span>
          Decision preview
        </h3>
        {decision.kind === "loading" && (
          <div className="h-12 animate-pulse rounded-xl bg-surface-container" />
        )}
        {decision.kind === "waiting" && (
          <p className="rounded-xl bg-surface-container-low px-3 py-3 text-sm font-semibold text-on-surface-variant">
            Waiting for judges — no counted votes yet ({panelSize} seats on this panel).
          </p>
        )}
        {decision.kind === "ready" && (
          <div>
            <p className="text-lg font-black text-on-surface">
              {formatDecisionLine(decision)}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-on-surface-variant">
              Points {decision.akaTotal.toFixed(1)} – {decision.aoTotal.toFixed(1)} ·{" "}
              {decisionMethodLabel(decision.method)}
            </p>
          </div>
        )}
        {decision.kind === "tie" && (
          <div className="space-y-3">
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">
              {formatDecisionLine({ winner: null, akaVotes: decision.akaVotes, aoVotes: decision.aoVotes, judgesCounted: decision.judgesCounted })}
              {" "}and total points are tied — a moderator decision (HANTEI) is required.
            </p>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Hantei: pick the winner">
              {(["AKA", "AO"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setHantei(side)}
                  aria-pressed={hantei === side}
                  className={`flex min-h-[60px] items-center justify-center gap-2 rounded-xl border-2 text-base font-black uppercase tracking-wide transition-all cursor-pointer active:scale-[0.98] ${
                    hantei === side
                      ? side === "AKA"
                        ? "border-[#DC2626] bg-[#DC2626] text-white shadow-md"
                        : "border-[#2563EB] bg-[#2563EB] text-white shadow-md"
                      : "border-outline-variant bg-white text-on-surface hover:border-on-surface-variant"
                  }`}
                >
                  <span className="material-symbols-outlined text-[22px]">gavel</span>
                  {side}
                </button>
              ))}
            </div>
          </div>
        )}
        {decision.kind === "error" && (
          <p className="rounded-xl border border-error/30 bg-error/5 px-3 py-2.5 text-sm font-semibold text-error">
            {decision.error}
          </p>
        )}
      </div>

      {/* Confirm — sticky above the phone bottom nav, static on desktop */}
      <div className="sticky bottom-28 z-20 lg:static lg:z-auto">
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-3 shadow-lg lg:shadow-sm">
          {confirmed || match.status === "CONFIRMED" ? (
            <p className="flex min-h-[56px] items-center justify-center gap-2 text-center text-sm font-extrabold text-emerald-700">
              <span className="material-symbols-outlined text-[22px]">verified</span>
              Winner: {winnerName} ({confirmed?.winnerSide ?? match.winnerSide})
              {confirmed ? ` · ${decisionMethodLabel(confirmed.method)}` : ""}
            </p>
          ) : (
            <>
              {confirmError && (
                <p className="mb-2 rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-sm font-semibold text-error">
                  {confirmError}
                </p>
              )}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirming || confirmSide == null}
                className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-black uppercase tracking-wide text-white shadow-md transition-all hover:opacity-90 disabled:opacity-40 cursor-pointer active:scale-[0.98]"
              >
                {confirming ? (
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <span className="material-symbols-outlined text-[24px]">check_circle</span>
                )}
                {confirmSide
                  ? `Confirm winner — ${confirmSide === "AKA" ? match.aka.name : match.ao.name} (${confirmSide})`
                  : "Confirm winner"}
              </button>
              {decision.kind === "tie" && !hantei && (
                <p className="mt-1.5 text-center text-xs font-semibold text-amber-800">
                  Pick the HANTEI winner above first.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
