"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { confirmBoutResult, updateLiveMatchState } from "@/actions/matches";
import { MatchClock } from "@/components/match/MatchClock";
import { useRingClockController } from "@/hooks/useRingClockController";
import type { RingClock } from "@/lib/matchClock";

interface Competitor {
  id?: string | null;
  name: string;
  school?: string;
  chestNumber?: string | null;
}

interface Props {
  match: {
    id: string;
    matchNo: number;
    roundName: string;
    aka: Competitor;
    ao: Competitor;
    akaScore?: number;
    aoScore?: number;
    akaPenalties?: number;
    aoPenalties?: number;
    senshu?: "AKA" | "AO" | null;
  };
  ringId?: string;
  categoryName: string;
  clock: RingClock;
  serverNow?: number;
  serverNowSentAt?: number;
  serverNowReceivedAt?: number;
  sidesSwapped?: boolean;
  nextBout?: {
    matchNo: number;
    roundName: string;
    aka: Competitor;
    ao: Competitor;
  } | null;
  onBoutCompleted: () => void;
  onClose?: () => void;
}

const PRESETS = [
  { sec: 90, label: "1:30" },
  { sec: 120, label: "2:00" },
  { sec: 180, label: "3:00" },
];

const PENALTY_LEVELS = [
  { level: 1, label: "1" },
  { level: 2, label: "2" },
  { level: 3, label: "3" },
  { level: 4, label: "HC" },
  { level: 5, label: "H" },
];

// Referee double-blast whistle, synthesised so the desk needs no audio asset.
const playBuzzerSound = () => {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const playBlast = (startTime: number, duration: number) => {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(1800, ctx.currentTime + startTime);
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1845, ctx.currentTime + startTime);

      gainNode.gain.setValueAtTime(0, ctx.currentTime + startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + startTime + 0.05);
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime + startTime + duration - 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(ctx.currentTime + startTime);
      osc2.start(ctx.currentTime + startTime);
      osc1.stop(ctx.currentTime + startTime + duration);
      osc2.stop(ctx.currentTime + startTime + duration);
    };

    playBlast(0, 0.4);
    playBlast(0.5, 0.7);
  } catch (e) {
    console.error("Audio buzzer error:", e);
  }
};

export function BoutScoringPad({
  match,
  ringId,
  categoryName,
  clock: initialClock,
  serverNow,
  serverNowSentAt,
  serverNowReceivedAt,
  sidesSwapped: initialSidesSwapped,
  nextBout,
  onBoutCompleted,
}: Props) {
  const [akaPoints, setAkaPoints] = useState(match.akaScore ?? 0);
  const [aoPoints, setAoPoints] = useState(match.aoScore ?? 0);
  const [akaPenalties, setAkaPenalties] = useState(match.akaPenalties ?? 0);
  const [aoPenalties, setAoPenalties] = useState(match.aoPenalties ?? 0);
  const [senshu, setSenshu] = useState<"AKA" | "AO" | null>(match.senshu ?? null);

  const [confirming, setConfirming] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showHanteiModal, setShowHanteiModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedWinnerSide, setSelectedWinnerSide] = useState<"AKA" | "AO" | null>(null);
  const [finishMethod, setFinishMethod] = useState<string>("POINTS");
  const [history, setHistory] = useState<any[]>([]);

  const [editMinutes, setEditMinutes] = useState("3");
  const [editSeconds, setEditSeconds] = useState("00");
  const [editMilliseconds, setEditMilliseconds] = useState("000");

  const padRef = useRef<HTMLDivElement>(null);

  const clock = useRingClockController({
    ringId: ringId ?? "",
    initialClock,
    initialServerNow: serverNow,
    initialServerNowSentAt: serverNowSentAt,
    initialServerNowReceivedAt: serverNowReceivedAt,
    initialSidesSwapped,
    onElapsed: playBuzzerSound,
  });

  const { remainingMs, running, pending, isLow, isExpired, sidesSwapped } = clock;

  // A brand new bout starts from the configured duration on every screen.
  useEffect(() => {
    setAkaPoints(match.akaScore ?? 0);
    setAoPoints(match.aoScore ?? 0);
    setAkaPenalties(match.akaPenalties ?? 0);
    setAoPenalties(match.aoPenalties ?? 0);
    setSenshu(match.senshu ?? null);
    setHistory([]);
    setShowFinishModal(false);
    if (ringId) {
      void clock.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  useEffect(() => {
    const total = clock.clock.durationMs;
    setEditMinutes(String(Math.floor(total / 60000)));
    setEditSeconds(String(Math.floor((total % 60000) / 1000)).padStart(2, "0"));
    setEditMilliseconds(String(total % 1000).padStart(3, "0"));
  }, [clock.clock.durationMs]);

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncLiveState = useCallback(
    (aP: number, oP: number, aPen: number, oPen: number, sen: "AKA" | "AO" | null) => {
      if (!ringId) return;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        updateLiveMatchState(match.id, ringId, {
          akaScore: aP,
          aoScore: oP,
          akaPenalties: aPen,
          aoPenalties: oPen,
          senshu: sen,
        }).catch((err) => console.error("Live state sync error:", err));
      }, 400);
    },
    [match.id, ringId]
  );

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  // Space / F1 control the clock from anywhere on the desk.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space" || e.key === "F1") {
        e.preventDefault();
        void clock.toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clock]);

  // Tap the clock to start/pause, hold to reset.
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLongPressedRef = useRef(false);
  const [isPressing, setIsPressing] = useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    hasLongPressedRef.current = false;
    setIsPressing(true);
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);

    longPressTimeoutRef.current = setTimeout(() => {
      hasLongPressedRef.current = true;
      setIsPressing(false);
      if (typeof window !== "undefined" && window.navigator?.vibrate) {
        window.navigator.vibrate(60);
      }
      void clock.reset();
    }, 850);
  };

  const handlePointerUp = () => {
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    setIsPressing(false);
    if (!hasLongPressedRef.current) {
      void clock.toggle();
    }
    hasLongPressedRef.current = false;
  };

  const handlePointerLeave = () => {
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    setIsPressing(false);
  };

  const saveClockSettings = () => {
    const mins = parseInt(editMinutes, 10) || 0;
    const secs = parseInt(editSeconds, 10) || 0;
    const ms = parseInt(editMilliseconds, 10) || 0;
    void clock.applyDuration(Math.max(1000, mins * 60000 + secs * 1000 + ms));
    setShowSettings(false);
  };

  const recordState = () => {
    setHistory((prev) => [
      ...prev,
      { akaPoints, aoPoints, akaPenalties, aoPenalties, senshu },
    ]);
  };

  const handleScore = (side: "AKA" | "AO", delta: number) => {
    recordState();
    if (side === "AKA") {
      const next = Math.max(0, akaPoints + delta);
      setAkaPoints(next);
      let nextSenshu = senshu;
      if (!senshu && aoPoints === 0 && delta > 0) {
        nextSenshu = "AKA";
        setSenshu("AKA");
      }
      syncLiveState(next, aoPoints, akaPenalties, aoPenalties, nextSenshu);
    } else {
      const next = Math.max(0, aoPoints + delta);
      setAoPoints(next);
      let nextSenshu = senshu;
      if (!senshu && akaPoints === 0 && delta > 0) {
        nextSenshu = "AO";
        setSenshu("AO");
      }
      syncLiveState(akaPoints, next, akaPenalties, aoPenalties, nextSenshu);
    }
  };

  const handleToggleSenshu = (side: "AKA" | "AO") => {
    recordState();
    const nextSenshu = senshu === side ? null : side;
    setSenshu(nextSenshu);
    syncLiveState(akaPoints, aoPoints, akaPenalties, aoPenalties, nextSenshu);
  };

  const handleSetPenalty = (side: "AKA" | "AO", level: number) => {
    recordState();
    if (side === "AKA") {
      const next = akaPenalties === level ? level - 1 : level;
      setAkaPenalties(next);
      syncLiveState(akaPoints, aoPoints, next, aoPenalties, senshu);
      if (next === 5) {
        setSelectedWinnerSide("AO");
        setFinishMethod("HANSOKU");
        setShowFinishModal(true);
      }
    } else {
      const next = aoPenalties === level ? level - 1 : level;
      setAoPenalties(next);
      syncLiveState(akaPoints, aoPoints, akaPenalties, next, senshu);
      if (next === 5) {
        setSelectedWinnerSide("AKA");
        setFinishMethod("HANSOKU");
        setShowFinishModal(true);
      }
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setAkaPoints(last.akaPoints);
    setAoPoints(last.aoPoints);
    setAkaPenalties(last.akaPenalties);
    setAoPenalties(last.aoPenalties);
    setSenshu(last.senshu);
    setHistory((prev) => prev.slice(0, prev.length - 1));
    syncLiveState(last.akaPoints, last.aoPoints, last.akaPenalties, last.aoPenalties, last.senshu);
  };

  const handleResetAll = () => {
    if (window.confirm("Reset all points, warnings, and clock for this bout?")) {
      recordState();
      setAkaPoints(0);
      setAoPoints(0);
      setAkaPenalties(0);
      setAoPenalties(0);
      setSenshu(null);
      syncLiveState(0, 0, 0, 0, null);
      void clock.reset();
    }
  };

  const pointDiff = Math.abs(akaPoints - aoPoints);
  const hasEightPointLead = pointDiff >= 8;
  const eightPointLeader = akaPoints > aoPoints ? "AKA" : "AO";

  const handleConfirmWinner = async (winnerSide: "AKA" | "AO", method = finishMethod) => {
    const winnerId = winnerSide === "AKA" ? match.aka.id : match.ao.id;
    if (!winnerId) {
      alert("Cannot confirm: winner athlete ID is missing from slot.");
      return;
    }

    try {
      setConfirming(true);
      await confirmBoutResult(match.id, winnerId, {
        side: winnerSide,
        akaPoints,
        aoPoints,
        akaPenalties,
        aoPenalties,
        senshu,
        method,
      });
      setShowFinishModal(false);
      onBoutCompleted();
    } catch (err) {
      alert(`Failed to confirm match: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setConfirming(false);
    }
  };

  const statusLabel =
    clock.clock.status === "running"
      ? "Running"
      : clock.clock.status === "paused"
        ? "Paused"
        : clock.clock.status === "finished"
          ? "Time up"
          : "Ready";

  const renderCompetitor = (side: "AKA" | "AO") => {
    const isAka = side === "AKA";
    const ath = isAka ? match.aka : match.ao;
    const points = isAka ? akaPoints : aoPoints;
    const penalties = isAka ? akaPenalties : aoPenalties;
    const hasSenshu = senshu === side;

    const accentText = isAka ? "text-[#DC2626]" : "text-[#2563EB]";
    const accentBorder = isAka ? "border-[#DC2626]" : "border-[#2563EB]";
    const accentBadge = isAka ? "bg-[#DC2626] text-white" : "bg-[#2563EB] text-white";
    const scoreButton = isAka
      ? "bg-[#DC2626] hover:bg-[#B91C1C]"
      : "bg-[#2563EB] hover:bg-[#1D4ED8]";

    return (
      <section
        aria-label={`${isAka ? "Aka, red" : "Ao, blue"} competitor`}
        className={`flex flex-col rounded-2xl border-2 bg-white p-4 shadow-sm sm:p-5 ${accentBorder}`}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-3 py-1 text-xs font-black uppercase tracking-wider ${accentBadge}`}>
              {isAka ? "AKA (RED)" : "AO (BLUE)"}
            </span>
            {ath.chestNumber && (
              <span className="rounded bg-[#F5F3EC] px-2 py-0.5 font-data-mono text-[11px] font-bold text-[#3D3A33]">
                #{ath.chestNumber}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => handleToggleSenshu(side)}
            aria-pressed={hasSenshu}
            className={`min-h-[36px] rounded-md border px-3 py-1 text-xs font-extrabold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
              hasSenshu
                ? "border-amber-500 bg-amber-400 text-amber-950"
                : "border-[#E1DDCF] bg-white text-[#8C877C] hover:text-[#1B1815]"
            }`}
            title="First uncontested point advantage"
          >
            ★ Senshu
          </button>
        </div>

        <div className="mb-4 min-w-0">
          <h3 className="truncate text-xl font-black tracking-tight text-[#1B1815] sm:text-2xl">
            {ath.name || "Competitor TBD"}
          </h3>
          <p className="truncate text-xs font-semibold uppercase text-[#68645A]">
            {ath.school || "Club / Academy"}
          </p>
        </div>

        <div className={`mb-4 flex w-full items-center justify-center rounded-xl border-2 bg-[#FAF9F5] py-3 sm:py-4 ${accentBorder}`}>
          <span className={`font-data-mono text-6xl font-black tabular-nums sm:text-7xl ${accentText}`}>
            {points}
          </span>
        </div>

        <div className="mb-2 grid grid-cols-3 gap-2">
          {[
            { delta: 1, label: "+1", sub: "Yuko" },
            { delta: 2, label: "+2", sub: "Waza-ari" },
            { delta: 3, label: "+3", sub: "Ippon" },
          ].map(({ delta, label, sub }) => (
            <button
              key={delta}
              type="button"
              onClick={() => handleScore(side, delta)}
              className={`min-h-[56px] rounded-xl px-1 py-2 font-black text-white shadow-2xs transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${scoreButton}`}
            >
              <span className="block text-base leading-none">{label}</span>
              <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide opacity-90">
                {sub}
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { delta: -1, label: "-1" },
            { delta: -2, label: "-2" },
            { delta: -3, label: "-3" },
          ].map(({ delta, label }) => (
            <button
              key={delta}
              type="button"
              onClick={() => handleScore(side, delta)}
              disabled={points + delta < 0}
              className="min-h-[40px] rounded-lg border border-[#E1DDCF] bg-white text-xs font-bold text-[#68645A] transition-colors hover:bg-[#F5F3EC] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-[#E1DDCF] pt-3">
          <span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
            WKF warnings
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {PENALTY_LEVELS.map(({ level, label }) => {
              const isActive = penalties >= level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleSetPenalty(side, level)}
                  aria-pressed={isActive}
                  className={`min-h-[44px] rounded-lg border text-xs font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
                    isActive
                      ? level === 5
                        ? "border-red-700 bg-red-600 text-white"
                        : "border-amber-600 bg-amber-500 text-white"
                      : "border-[#E1DDCF] bg-[#F5F3EC] text-[#68645A] hover:bg-[#ECE9DF]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  };

  // No overflow clipping on the container below: it would create a scroll
  // context and break the sticky clock bar.
  return (
    <div ref={padRef} className="rounded-2xl border border-[#E1DDCF] bg-[#FAF9F5] shadow-sm">
      {/* Clock bar — sticky so the time is never scrolled away from the operator */}
      <div className="sticky top-16 z-30 rounded-t-2xl border-b border-[#2A2622] bg-[#1B1815] px-3 py-3 text-white sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#0E9C7C] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider">
                Bout #{match.matchNo}
              </span>
              <span className="truncate text-xs font-bold uppercase text-neutral-400">
                {match.roundName}
              </span>
            </div>
            <h2 className="mt-0.5 truncate text-sm font-bold text-white sm:text-base">
              {categoryName}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") void clock.toggle();
              }}
              className={`cursor-pointer rounded-xl border px-3 py-2 transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                isPressing ? "scale-95 border-neutral-500 bg-neutral-900" : "border-neutral-700 bg-black/60 hover:border-neutral-500"
              } ${isLow ? "border-amber-500/80" : ""} ${isExpired ? "border-red-600/80 bg-red-950/20" : ""}`}
              title="Tap to start or pause · hold to reset"
            >
              <MatchClock
                remainingMs={remainingMs}
                status={clock.clock.status}
                size="mod"
                tone="dark"
                offsetMs={clock.offsetMs}
              />
            </div>

            <button
              type="button"
              onClick={() => void clock.toggle()}
              disabled={pending}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-black uppercase shadow-sm transition-transform active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1B1815] ${
                running ? "bg-amber-500 text-black hover:bg-amber-600" : "bg-[#0E9C7C] text-white hover:bg-[#0B7C63]"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {running ? "pause" : "play_arrow"}
              </span>
              {running ? "Pause" : "Start"}
            </button>

            <div className="flex items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-800/90 p-1">
              {[
                { delta: 1000, label: "+1s" },
                { delta: -1000, label: "-1s" },
                { delta: 100, label: "+.1" },
                { delta: -100, label: "-.1" },
              ].map(({ delta, label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => void clock.adjust(delta)}
                  disabled={pending}
                  className="min-h-[36px] min-w-[36px] rounded-lg px-2 py-1.5 font-data-mono text-[11px] font-bold text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                  title={`${delta > 0 ? "Add" : "Deduct"} ${Math.abs(delta)} milliseconds`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                title="Set an exact duration"
                aria-label="Set an exact duration"
              >
                <span className="material-symbols-outlined text-[18px]">tune</span>
              </button>
            </div>

            <div className="hidden items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-800/90 p-1 md:flex">
              {PRESETS.map(({ sec, label }) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => void clock.applyDuration(sec * 1000)}
                  disabled={pending}
                  className={`min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                    clock.clock.durationMs === sec * 1000
                      ? "bg-[#0E9C7C] text-white"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <span
              className="hidden text-[11px] font-bold uppercase tracking-wider text-neutral-400 lg:inline"
              aria-live="polite"
            >
              {statusLabel}
            </span>
          </div>
        </div>

        {clock.error && (
          <p role="alert" className="mt-2 rounded-lg bg-red-950/60 px-3 py-1.5 text-xs font-semibold text-red-200">
            {clock.error}
          </p>
        )}

        {hasEightPointLead && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-500/50 bg-amber-500/20 px-4 py-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
              <span className="material-symbols-outlined text-[18px]">gavel</span>
              <span>
                8-point lead · {eightPointLeader} ahead by {pointDiff}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedWinnerSide(eightPointLeader);
                setFinishMethod("8_POINT_LEAD");
                setShowFinishModal(true);
              }}
              className="min-h-[36px] rounded-lg bg-amber-500 px-3 py-1 text-xs font-black uppercase text-black transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              End bout now
            </button>
          </div>
        )}
      </div>

      {/* Competitor grid: stacked on phones, side by side from tablet up */}
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 sm:p-6">
        {sidesSwapped ? renderCompetitor("AO") : renderCompetitor("AKA")}
        {sidesSwapped ? renderCompetitor("AKA") : renderCompetitor("AO")}
      </div>

      {/* Next fighters, so the desk knows what is coming */}
      {nextBout && (
        <div className="mx-4 mb-4 flex items-center gap-2 rounded-xl border border-[#E1DDCF] bg-white px-4 py-2.5 text-xs sm:mx-6">
          <span className="font-black uppercase tracking-wider text-[#8C877C]">On deck</span>
          <span className="truncate font-bold text-[#1B1815]">
            Bout #{nextBout.matchNo} · {nextBout.aka.name || "TBD"} vs {nextBout.ao.name || "TBD"}
          </span>
        </div>
      )}

      {/* Action bar — confirm sits in the thumb zone on phones */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-[#E1DDCF] bg-[#F5F3EC] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void clock.setSwapped(!sidesSwapped)}
            aria-pressed={sidesSwapped}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
              sidesSwapped
                ? "border-[#0E9C7C] bg-[#E3F6F0] text-[#0B7C63]"
                : "border-[#E1DDCF] bg-white text-[#1B1815] hover:bg-[#FAF9F5]"
            }`}
            title="Mirror which side appears on the left of the arena screen"
          >
            <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
            Swap sides {sidesSwapped ? "· AKA right" : "· AKA left"}
          </button>

          <button
            type="button"
            onClick={() => setShowHanteiModal(true)}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#E1DDCF] bg-white px-3 py-2 text-xs font-bold text-[#1B1815] transition-colors hover:bg-[#FAF9F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2"
          >
            <span className="material-symbols-outlined text-[16px]">how_to_vote</span>
            Hantei
          </button>

          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#E1DDCF] bg-white px-3 py-2 text-xs font-bold text-[#1B1815] transition-colors hover:bg-[#FAF9F5] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2"
          >
            <span className="material-symbols-outlined text-[16px]">undo</span>
            Undo
          </button>

          <button
            type="button"
            onClick={handleResetAll}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            Reset
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            let defaultSide: "AKA" | "AO" = "AKA";
            if (akaPoints > aoPoints) defaultSide = "AKA";
            else if (aoPoints > akaPoints) defaultSide = "AO";
            else if (senshu) defaultSide = senshu;

            setSelectedWinnerSide(defaultSide);
            setFinishMethod(akaPoints !== aoPoints ? "POINTS" : senshu ? "SENSHU" : "HANTEI");
            setShowFinishModal(true);
          }}
          disabled={confirming}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#0E9C7C] px-6 py-3 text-sm font-extrabold uppercase text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 sm:w-auto"
        >
          <span className="material-symbols-outlined text-[18px]">verified</span>
          Confirm result
        </button>
      </div>

      {/* Exact duration */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#E1DDCF] bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-extrabold text-[#1B1815]">Set the bout clock</h3>
            <p className="mb-4 text-xs text-[#68645A]">
              This duration is used by the moderator desk and the arena screen together.
            </p>

            <div className="mb-5 grid grid-cols-3 gap-3">
              {[
                { label: "Minutes", value: editMinutes, set: setEditMinutes, max: 59 },
                { label: "Seconds", value: editSeconds, set: setEditSeconds, max: 59 },
                { label: "Millis", value: editMilliseconds, set: setEditMilliseconds, max: 999 },
              ].map(({ label, value, set, max }) => (
                <div key={label}>
                  <label className="mb-1 block text-[10px] font-black uppercase text-[#68645A]">
                    {label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={max}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className="w-full rounded-xl border border-[#E1DDCF] px-3 py-2 text-center font-data-mono text-base font-bold text-[#1B1815] focus:border-[#0E9C7C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#E1DDCF] pt-4">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="min-h-[44px] rounded-xl border border-[#E1DDCF] px-4 py-2 text-xs font-bold text-[#68645A] hover:bg-[#F5F3EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveClockSettings}
                className="min-h-[44px] rounded-xl bg-[#0E9C7C] px-5 py-2 text-xs font-black uppercase text-white hover:bg-[#0B7C63] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2"
              >
                Save clock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm result */}
      {showFinishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E1DDCF] bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-extrabold text-[#1B1815]">
              Confirm bout #{match.matchNo}
            </h3>
            <p className="mb-4 text-xs text-[#68645A]">
              Pick the winner and the decision method to advance the bracket.
            </p>

            <div className="mb-4 grid grid-cols-2 gap-3">
              {(["AKA", "AO"] as const).map((side) => {
                const isAka = side === "AKA";
                const ath = isAka ? match.aka : match.ao;
                const selected = selectedWinnerSide === side;
                return (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setSelectedWinnerSide(side)}
                    className={`rounded-xl border-2 p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                      selected
                        ? isAka
                          ? "border-[#DC2626] bg-red-50"
                          : "border-[#2563EB] bg-blue-50"
                        : "border-[#E1DDCF] bg-white hover:border-[#8C877C]"
                    }`}
                  >
                    <span
                      className={`mb-1.5 block w-max rounded px-2 py-0.5 text-[10px] font-black uppercase text-white ${
                        isAka ? "bg-[#DC2626]" : "bg-[#2563EB]"
                      }`}
                    >
                      {isAka ? "Aka (red)" : "Ao (blue)"}
                    </span>
                    <p className="truncate text-sm font-extrabold text-[#1B1815]">{ath.name}</p>
                    <p className={`mt-1 font-data-mono text-xs font-bold ${isAka ? "text-[#DC2626]" : "text-[#2563EB]"}`}>
                      {isAka ? akaPoints : aoPoints} points
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="mb-5">
              <label htmlFor="decision-method" className="mb-1 block text-xs font-bold uppercase tracking-wider text-[#3D3A33]">
                Decision method
              </label>
              <select
                id="decision-method"
                value={finishMethod}
                onChange={(e) => setFinishMethod(e.target.value)}
                className="w-full rounded-xl border border-[#E1DDCF] bg-white px-3 py-2 text-base font-semibold text-[#1B1815] focus:border-[#0E9C7C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:text-sm"
              >
                <option value="POINTS">Points difference</option>
                <option value="SENSHU">Senshu (first point)</option>
                <option value="8_POINT_LEAD">8-point lead</option>
                <option value="HANTEI">Hantei (judges)</option>
                <option value="KIKEN">Kiken (injury / forfeit)</option>
                <option value="HANSOKU">Hansoku (disqualification)</option>
                <option value="SHIKKAKU">Shikkaku (severe misconduct)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#E1DDCF] pt-4">
              <button
                type="button"
                onClick={() => setShowFinishModal(false)}
                disabled={confirming}
                className="min-h-[44px] rounded-xl border border-[#E1DDCF] px-4 py-2 text-xs font-bold text-[#68645A] hover:bg-[#F5F3EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => selectedWinnerSide && handleConfirmWinner(selectedWinnerSide)}
                disabled={!selectedWinnerSide || confirming}
                className="min-h-[44px] rounded-xl bg-[#0E9C7C] px-5 py-2 text-xs font-black uppercase text-white hover:bg-[#0B7C63] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2"
              >
                {confirming ? "Advancing…" : "Confirm & advance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hantei */}
      {showHanteiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#E1DDCF] bg-white p-5 shadow-2xl">
            <h3 className="mb-1 text-base font-extrabold text-[#1B1815]">Hantei</h3>
            <p className="mb-4 text-xs text-[#68645A]">
              Tied bout without senshu: declare the majority flag winner.
            </p>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedWinnerSide("AKA");
                  setFinishMethod("HANTEI");
                  setShowHanteiModal(false);
                  setShowFinishModal(true);
                }}
                className="min-h-[56px] rounded-xl border-2 border-[#DC2626] p-4 text-center text-sm font-black uppercase text-[#DC2626] transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626]"
              >
                Aka flags
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedWinnerSide("AO");
                  setFinishMethod("HANTEI");
                  setShowHanteiModal(false);
                  setShowFinishModal(true);
                }}
                className="min-h-[56px] rounded-xl border-2 border-[#2563EB] p-4 text-center text-sm font-black uppercase text-[#2563EB] transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
              >
                Ao flags
              </button>
            </div>

            <div className="text-right">
              <button
                type="button"
                onClick={() => setShowHanteiModal(false)}
                className="min-h-[44px] rounded-lg px-3 text-xs font-bold text-[#68645A] hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
