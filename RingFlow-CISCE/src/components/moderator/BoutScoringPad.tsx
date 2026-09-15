"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { confirmBoutResult, updateLiveMatchState, updateRingTimerState } from "@/actions/matches";

interface Props {
  match: {
    id: string;
    matchNo: number;
    roundName: string;
    aka: { id?: string | null; name: string; school?: string; chestNumber?: string | null };
    ao: { id?: string | null; name: string; school?: string; chestNumber?: string | null };
    akaScore?: number;
    aoScore?: number;
    akaPenalties?: number;
    aoPenalties?: number;
    senshu?: "AKA" | "AO" | null;
  };
  ringId?: string;
  categoryName: string;
  onBoutCompleted: () => void;
  onClose?: () => void;
}

const DEFAULT_DURATION_MS = 3 * 60 * 1000; // 3:00.000 default

// Referee double-blast whistle synthesizer using Web Audio API
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
  onBoutCompleted,
  onClose,
}: Props) {
  // Score state
  const [akaPoints, setAkaPoints] = useState(match.akaScore ?? 0);
  const [aoPoints, setAoPoints] = useState(match.aoScore ?? 0);
  const [akaPenalties, setAkaPenalties] = useState(match.akaPenalties ?? 0);
  const [aoPenalties, setAoPenalties] = useState(match.aoPenalties ?? 0);
  const [senshu, setSenshu] = useState<"AKA" | "AO" | null>(match.senshu ?? null);
  const [isSwapped, setIsSwapped] = useState(false);

  // ─── Timer State ───────────────────────────────────────────────────────────
  // Always start fresh — never read stale ring DB state.
  // timerOriginRef is the wall-clock time when the CURRENT run segment started,
  // anchored to include any prior elapsed time:
  //   origin = Date.now() - elapsedAtPauseMs
  // So: elapsed = Date.now() - origin  →  remaining = configuredDurationMs - elapsed
  const [configuredDurationMs, setConfiguredDurationMs] = useState(DEFAULT_DURATION_MS);
  const [timeLeftMs, setTimeLeftMs] = useState(DEFAULT_DURATION_MS);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerOriginRef = useRef<number>(Date.now()); // updated on every START

  // Settings & Edit Modal
  const [showSettings, setShowSettings] = useState(false);
  const [editMinutes, setEditMinutes] = useState(String(Math.floor(DEFAULT_DURATION_MS / 60000)));
  const [editSeconds, setEditSeconds] = useState(String(Math.floor((DEFAULT_DURATION_MS % 60000) / 1000)).padStart(2, "0"));
  const [editMilliseconds, setEditMilliseconds] = useState(String(DEFAULT_DURATION_MS % 1000).padStart(3, "0"));

  // Gestures
  const [isPressing, setIsPressing] = useState(false);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLongPressedRef = useRef(false);

  // Confirmation & Decision Modals
  const [confirming, setConfirming] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showHanteiModal, setShowHanteiModal] = useState(false);
  const [selectedWinnerSide, setSelectedWinnerSide] = useState<"AKA" | "AO" | null>(null);
  const [finishMethod, setFinishMethod] = useState<string>("POINTS");

  // History stack for Undo
  const [history, setHistory] = useState<any[]>([]);

  // Reset scores + timer completely when a NEW match is loaded
  useEffect(() => {
    setAkaPoints(match.akaScore ?? 0);
    setAoPoints(match.aoScore ?? 0);
    setAkaPenalties(match.akaPenalties ?? 0);
    setAoPenalties(match.aoPenalties ?? 0);
    setSenshu(match.senshu ?? null);
    // Full timer reset for new match
    setTimeLeftMs(configuredDurationMs);
    setTimerRunning(false);
    timerOriginRef.current = Date.now();
    setHistory([]);
    setShowFinishModal(false);
    // Also reset DB timer state so scoreboard shows full duration
    if (ringId) {
      updateRingTimerState(ringId, {
        timerStatus: "idle",
        timerAccumulatedSeconds: 0,
        timerStartedAt: null,
        timerPausedAt: null,
      }).catch(() => {});
    }
  }, [match.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync with live score in DB
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);
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

  // ─── High-Precision Countdown (~30 FPS, drift-free) ────────────────────────
  // Uses timerOriginRef so deps are ONLY [timerRunning, configuredDurationMs].
  // This prevents the interval from being torn down & recreated every 33ms.
  useEffect(() => {
    if (!timerRunning) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - timerOriginRef.current;
      const remaining = configuredDurationMs - elapsed;
      if (remaining <= 0) {
        setTimeLeftMs(0);
        setTimerRunning(false);
        playBuzzerSound();
        if (ringId) {
          updateRingTimerState(ringId, {
            timerStatus: "finished",
            timerAccumulatedSeconds: Math.floor(configuredDurationMs / 1000),
            timerStartedAt: null,
          }).catch(() => {});
        }
      } else {
        setTimeLeftMs(remaining);
      }
    }, 33);

    return () => clearInterval(interval);
  }, [timerRunning, configuredDurationMs, ringId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up long-press timeout on unmount
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    };
  }, []);

  // Keyboard shortcut listener (Spacebar or F1 toggles Start/Stop)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === "Space" || e.key === "F1") {
        e.preventDefault();
        setTimerRunning((r) => {
          const next = !r;
          if (ringId) {
            if (next) {
              // STARTING: set origin so elapsed = configuredDuration - timeLeftMs
              timerOriginRef.current = Date.now() - (configuredDurationMs - timeLeftMs);
              updateRingTimerState(ringId, {
                timerStatus: "running",
                timerAccumulatedSeconds: Math.floor((configuredDurationMs - timeLeftMs) / 1000),
                timerStartedAt: new Date(timerOriginRef.current),
                timerPausedAt: null,
              }).catch(() => {});
            } else {
              // PAUSING: compute elapsed from origin (accurate, not lagging 33ms)
              const elapsedMs = Date.now() - timerOriginRef.current;
              updateRingTimerState(ringId, {
                timerStatus: "paused",
                timerAccumulatedSeconds: Math.floor(Math.min(elapsedMs, configuredDurationMs) / 1000),
                timerStartedAt: null,
                timerPausedAt: new Date(),
              }).catch(() => {});
            }
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [ringId, configuredDurationMs, timeLeftMs]);

  // Gesture Controls for Timer: tap to start/pause, long-press to reset
  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    hasLongPressedRef.current = false;
    setIsPressing(true);

    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);

    longPressTimeoutRef.current = setTimeout(() => {
      // Long press: RESET to full configured duration
      setTimerRunning(false);
      setTimeLeftMs(configuredDurationMs);
      timerOriginRef.current = Date.now();
      hasLongPressedRef.current = true;
      setIsPressing(false);

      if (typeof window !== "undefined" && window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(60);
      }

      if (ringId) {
        updateRingTimerState(ringId, {
          timerStatus: "idle",
          timerAccumulatedSeconds: 0,
          timerStartedAt: null,
          timerPausedAt: null,
        }).catch(() => {});
      }
    }, 850);
  };

  const handlePointerUp = () => {
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    setIsPressing(false);

    if (!hasLongPressedRef.current) {
      const next = !timerRunning;
      setTimerRunning(next);
      if (ringId) {
        if (next) {
          // STARTING: anchor timerOriginRef so elapsed = configuredDuration - timeLeftMs
          timerOriginRef.current = Date.now() - (configuredDurationMs - timeLeftMs);
          updateRingTimerState(ringId, {
            timerStatus: "running",
            timerAccumulatedSeconds: Math.floor((configuredDurationMs - timeLeftMs) / 1000),
            timerStartedAt: new Date(timerOriginRef.current),
            timerPausedAt: null,
          }).catch(() => {});
        } else {
          // PAUSING: read elapsed from timerOriginRef (exact, not lagging 33ms)
          const elapsedMs = Date.now() - timerOriginRef.current;
          updateRingTimerState(ringId, {
            timerStatus: "paused",
            timerAccumulatedSeconds: Math.floor(Math.min(elapsedMs, configuredDurationMs) / 1000),
            timerStartedAt: null,
            timerPausedAt: new Date(),
          }).catch(() => {});
        }
      }
    }
    hasLongPressedRef.current = false;
  };

  const handlePointerLeave = () => {
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    setIsPressing(false);
  };

  // Fine-grained adjustments (+/- ms or s)
  const handleAdjustMs = (deltaMs: number) => {
    setTimeLeftMs((prev) => {
      const next = Math.max(0, prev + deltaMs);
      // Shift the origin so the running interval reflects the new time immediately
      timerOriginRef.current = Date.now() - (configuredDurationMs - next);
      const newElapsedMs = configuredDurationMs - next;
      if (ringId) {
        if (timerRunning) {
          updateRingTimerState(ringId, {
            timerStatus: "running",
            timerAccumulatedSeconds: Math.floor(newElapsedMs / 1000),
            timerStartedAt: new Date(timerOriginRef.current),
          }).catch(() => {});
        } else {
          updateRingTimerState(ringId, {
            timerStatus: "paused",
            timerAccumulatedSeconds: Math.floor(newElapsedMs / 1000),
          }).catch(() => {});
        }
      }
      return next;
    });
  };

  // Save Configured Duration from Settings Modal
  const handleSaveTimerSettings = () => {
    const mins = parseInt(editMinutes, 10) || 0;
    const secs = parseInt(editSeconds, 10) || 0;
    const ms = parseInt(editMilliseconds, 10) || 0;
    const totalMs = Math.max(10, mins * 60 * 1000 + secs * 1000 + ms);

    setConfiguredDurationMs(totalMs);
    setTimeLeftMs(totalMs);
    setTimerRunning(false);
    setShowSettings(false);

    if (ringId) {
      updateRingTimerState(ringId, {
        timerStatus: "idle",
        timerAccumulatedSeconds: 0,
      }).catch(() => {});
    }
  };

  const handleSetPreset = (totalSec: number) => {
    const totalMs = totalSec * 1000;
    setConfiguredDurationMs(totalMs);
    setTimeLeftMs(totalMs);
    setTimerRunning(false);
    setEditMinutes(String(Math.floor(totalSec / 60)));
    setEditSeconds(String(totalSec % 60).padStart(2, "0"));
    setEditMilliseconds("000");

    if (ringId) {
      updateRingTimerState(ringId, {
        timerStatus: "idle",
        timerAccumulatedSeconds: 0,
      }).catch(() => {});
    }
  };

  const recordState = () => {
    setHistory((prev) => [
      ...prev,
      { akaPoints, aoPoints, akaPenalties, aoPenalties, senshu, timeLeftMs },
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
    if (last.timeLeftMs !== undefined) setTimeLeftMs(last.timeLeftMs);
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
      setTimeLeftMs(configuredDurationMs);
      setTimerRunning(false);
      syncLiveState(0, 0, 0, 0, null);
    }
  };

  // Time format: MM:SS.mmm
  const displayMinutes = Math.floor(timeLeftMs / 60000);
  const displaySeconds = Math.floor((timeLeftMs % 60000) / 1000);
  const displayMs = Math.floor(timeLeftMs % 1000);
  const formattedTime = `${String(displayMinutes).padStart(2, "0")}:${String(displaySeconds).padStart(2, "0")}.${String(displayMs).padStart(3, "0")}`;

  // 8-Point Difference check (WKF Kumite Rule)
  const pointDiff = Math.abs(akaPoints - aoPoints);
  const hasEightPointLead = pointDiff >= 8;
  const eightPointLeader = akaPoints > aoPoints ? "AKA" : "AO";

  // Confirm match winner and advance
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
    } catch (err: any) {
      alert(`Failed to confirm match: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  };

  // Competitor Card Render
  const renderCompetitor = (side: "AKA" | "AO") => {
    const isAka = side === "AKA";
    const ath = isAka ? match.aka : match.ao;
    const points = isAka ? akaPoints : aoPoints;
    const penalties = isAka ? akaPenalties : aoPenalties;
    const hasSenshu = senshu === side;

    const bgBadge = isAka ? "bg-[#DC2626]" : "bg-[#2563EB]";
    const borderCol = isAka ? "border-[#DC2626]" : "border-[#2563EB]";
    const textCol = isAka ? "text-[#DC2626]" : "text-[#2563EB]";
    const shadowCol = isAka ? "shadow-red-500/10" : "shadow-blue-500/10";

    return (
      <div className={`flex flex-col bg-white rounded-2xl border-2 ${borderCol} p-4 sm:p-5 shadow-sm ${shadowCol}`}>
        {/* Top Header */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-white font-black text-xs tracking-wider uppercase ${bgBadge}`}>
              {isAka ? "AKA (RED)" : "AO (BLUE)"}
            </span>
            {ath.chestNumber && (
              <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 text-[10px] font-bold font-mono">
                #{ath.chestNumber}
              </span>
            )}
          </div>

          {/* Senshu Badge */}
          <button
            type="button"
            onClick={() => handleToggleSenshu(side)}
            className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase transition-all cursor-pointer border ${
              hasSenshu
                ? "bg-amber-400 text-amber-950 border-amber-500 shadow-xs ring-2 ring-amber-400/40"
                : "bg-neutral-100 text-neutral-400 border-neutral-200 hover:text-neutral-700"
            }`}
            title="First uncontested point advantage"
          >
            ★ Senshu
          </button>
        </div>

        {/* Competitor Name & School */}
        <div className="mb-4">
          <h3 className="text-xl sm:text-2xl font-black text-[#1B1815] tracking-tight truncate">
            {ath.name || "Competitor TBD"}
          </h3>
          <p className="text-xs font-semibold text-[#68645A] truncate uppercase">
            {ath.school || "Club / Academy"}
          </p>
        </div>

        {/* Giant Score Box */}
        <div className={`w-full py-4 rounded-xl border-2 ${borderCol} bg-neutral-50 flex items-center justify-center mb-4`}>
          <span className={`font-mono font-black text-6xl sm:text-7xl ${textCol}`}>
            {points}
          </span>
        </div>

        {/* Points Controls (+1 Yuko, +2 Waza-ari, +3 Ippon) */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <button
            type="button"
            onClick={() => handleScore(side, 1)}
            className={`py-3.5 rounded-xl font-black text-sm uppercase text-white shadow-2xs active:scale-95 transition-all cursor-pointer min-h-[44px] ${
              isAka ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            +1 Yuko
          </button>
          <button
            type="button"
            onClick={() => handleScore(side, 2)}
            className={`py-3.5 rounded-xl font-black text-sm uppercase text-white shadow-2xs active:scale-95 transition-all cursor-pointer min-h-[44px] ${
              isAka ? "bg-red-700 hover:bg-red-800" : "bg-blue-700 hover:bg-blue-800"
            }`}
          >
            +2 Waza-ari
          </button>
          <button
            type="button"
            onClick={() => handleScore(side, 3)}
            className={`py-3.5 rounded-xl font-black text-sm uppercase text-white shadow-2xs active:scale-95 transition-all cursor-pointer min-h-[44px] ${
              isAka ? "bg-red-800 hover:bg-red-900" : "bg-blue-800 hover:bg-blue-900"
            }`}
          >
            +3 Ippon
          </button>
        </div>

        {/* Correction Controls (-1, -2, -3) */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <button
            type="button"
            onClick={() => handleScore(side, -1)}
            disabled={points <= 0}
            className="py-2 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 font-bold text-xs active:scale-95 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-[38px]"
          >
            -1 Yuko
          </button>
          <button
            type="button"
            onClick={() => handleScore(side, -2)}
            disabled={points < 2}
            className="py-2 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 font-bold text-xs active:scale-95 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-[38px]"
          >
            -2 Waza-ari
          </button>
          <button
            type="button"
            onClick={() => handleScore(side, -3)}
            disabled={points < 3}
            className="py-2 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 font-bold text-xs active:scale-95 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-[38px]"
          >
            -3 Ippon
          </button>
        </div>

        {/* WKF Warnings Row (1, 2, 3, HC, H) */}
        <div className="mt-auto pt-3 border-t border-neutral-100">
          <span className="text-[10px] font-black tracking-wider text-neutral-400 uppercase block mb-2">
            WKF WARNINGS & PENALTIES
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {[
              { level: 1, label: "1" },
              { level: 2, label: "2" },
              { level: 3, label: "3" },
              { level: 4, label: "HC" },
              { level: 5, label: "H (DQ)" },
            ].map(({ level, label }) => {
              const isActive = penalties >= level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleSetPenalty(side, level)}
                  className={`py-2.5 rounded-lg font-black text-xs transition-all cursor-pointer border min-h-[40px] ${
                    isActive
                      ? level === 5
                        ? "bg-red-600 text-white border-red-700 ring-2 ring-red-500/30"
                        : "bg-amber-500 text-white border-amber-600 ring-1 ring-amber-500/20"
                      : "bg-neutral-100 hover:bg-neutral-200 text-neutral-600 border-neutral-200"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-[#FAF9F5] border border-[#E1DDCF] rounded-2xl shadow-sm overflow-hidden">
      {/* Top Banner with High-Precision Millisecond Timer */}
      <div className="bg-[#1B1815] text-white px-4 sm:px-6 py-4 border-b border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-[#0E9C7C] text-white text-[10px] font-black uppercase tracking-wider">
                Bout #{match.matchNo}
              </span>
              <span className="text-xs font-bold text-neutral-400 uppercase">
                {match.roundName}
              </span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight mt-0.5">
              {categoryName}
            </h2>
          </div>

          {/* Center High-Precision Timer Controls */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Interactive Clock Box: Tap to Play/Pause, Hold 850ms to Reset */}
            <div
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              className={`flex items-center bg-black/60 border rounded-xl px-4 py-2 select-none cursor-pointer transition-all ${
                isPressing ? "scale-95 bg-neutral-900 border-neutral-500" : "hover:border-neutral-500"
              } ${
                timeLeftMs <= 15000 && timeLeftMs > 0
                  ? "border-amber-500/80"
                  : timeLeftMs === 0
                  ? "border-red-600/80 bg-red-950/20"
                  : "border-neutral-700"
              }`}
              title="Tap to Start/Pause · Hold down to Reset"
            >
              <span
                className={`font-mono text-2xl sm:text-4xl font-black tracking-wider ${
                  timeLeftMs <= 15000 && timeLeftMs > 0
                    ? "text-amber-400"
                    : timeLeftMs === 0
                    ? "text-red-500 font-black"
                    : "text-white"
                }`}
              >
                {formattedTime}
              </span>
            </div>

            {/* Play/Pause Button */}
            <button
              type="button"
              onClick={() => {
                const next = !timerRunning;
                setTimerRunning(next);
                if (ringId) {
                  updateRingTimerState(ringId, {
                    timerStatus: next ? "running" : "paused",
                    timerAccumulatedSeconds: Math.floor((configuredDurationMs - timeLeftMs) / 1000),
                    timerStartedAt: next ? new Date() : null,
                    timerPausedAt: next ? null : new Date(),
                  }).catch(() => {});
                }
              }}
              className={`px-4 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-1.5 shadow-sm transition-all cursor-pointer min-h-[44px] ${
                timerRunning
                  ? "bg-amber-500 hover:bg-amber-600 text-black active:scale-95"
                  : "bg-[#0E9C7C] hover:bg-[#0B7C63] text-white active:scale-95"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {timerRunning ? "pause" : "play_arrow"}
              </span>
              {timerRunning ? "Pause" : "Start"}
            </button>

            {/* Quick +/- Seconds & Milliseconds Adjustments */}
            <div className="flex items-center gap-1 bg-neutral-800/90 p-1 rounded-xl border border-neutral-700">
              <button
                type="button"
                onClick={() => handleAdjustMs(1000)}
                className="px-2 py-1.5 rounded-lg text-xs font-bold text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors min-h-[36px]"
                title="Add 1 Second"
              >
                +1s
              </button>
              <button
                type="button"
                onClick={() => handleAdjustMs(-1000)}
                className="px-2 py-1.5 rounded-lg text-xs font-bold text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors min-h-[36px]"
                title="Deduct 1 Second"
              >
                -1s
              </button>
              <button
                type="button"
                onClick={() => handleAdjustMs(100)}
                className="px-2 py-1.5 rounded-lg text-[11px] font-mono font-bold text-amber-300 hover:bg-neutral-700 transition-colors min-h-[36px]"
                title="Fine-tune: Add 100 Milliseconds"
              >
                +100ms
              </button>
              <button
                type="button"
                onClick={() => handleAdjustMs(-100)}
                className="px-2 py-1.5 rounded-lg text-[11px] font-mono font-bold text-amber-300 hover:bg-neutral-700 transition-colors min-h-[36px]"
                title="Fine-tune: Deduct 100 Milliseconds"
              >
                -100ms
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors min-h-[36px] flex items-center justify-center"
                title="Exact Time Settings (MM:SS.mmm)"
              >
                <span className="material-symbols-outlined text-[18px]">settings</span>
              </button>
            </div>

            {/* Standard Presets */}
            <div className="hidden lg:flex items-center gap-1 bg-neutral-800/90 p-1 rounded-xl border border-neutral-700 text-xs">
              {[
                { sec: 90, label: "1:30" },
                { sec: 120, label: "2:00" },
                { sec: 180, label: "3:00" },
              ].map(({ sec, label }) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => handleSetPreset(sec)}
                  className={`px-2 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                    configuredDurationMs === sec * 1000
                      ? "bg-[#0E9C7C] text-white"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 8-Point Superiority Banner */}
        {hasEightPointLead && (
          <div className="mt-3 bg-amber-500/20 border border-amber-500/50 rounded-xl px-4 py-2 flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-2 text-amber-300 font-bold text-xs uppercase tracking-wider">
              <span className="material-symbols-outlined text-[18px]">gavel</span>
              <span>8-Point Lead Superiority ({eightPointLeader} leads by {pointDiff} pts)</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedWinnerSide(eightPointLeader);
                setFinishMethod("8_POINT_LEAD");
                setShowFinishModal(true);
              }}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black text-xs font-black rounded-lg uppercase shadow-xs transition-all cursor-pointer"
            >
              End Bout Now
            </button>
          </div>
        )}
      </div>

      {/* Main Scoring Arena Grid */}
      <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {isSwapped ? renderCompetitor("AO") : renderCompetitor("AKA")}
        {isSwapped ? renderCompetitor("AKA") : renderCompetitor("AO")}
      </div>

      {/* Control Bar Actions (Swap, HT, Undo, Reset All, Confirm Result) */}
      <div className="bg-[#F5F3EC] border-t border-[#E1DDCF] px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Swap Sides Button */}
          <button
            type="button"
            onClick={() => setIsSwapped(!isSwapped)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E1DDCF] hover:bg-neutral-50 text-[#1B1815] text-xs font-bold transition-colors cursor-pointer shadow-2xs min-h-[40px]"
            title="Swap AKA/AO positions on screen"
          >
            <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
            Swap Sides
          </button>

          {/* Hantei (Referee Flags) */}
          <button
            type="button"
            onClick={() => setShowHanteiModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E1DDCF] hover:bg-neutral-50 text-[#1B1815] text-xs font-bold transition-colors cursor-pointer shadow-2xs min-h-[40px]"
            title="Referee Decision (Flags)"
          >
            <span className="material-symbols-outlined text-[16px]">how_to_vote</span>
            Hantei (HT)
          </button>

          {/* Undo Button */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E1DDCF] hover:bg-neutral-50 text-[#1B1815] text-xs font-bold transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed min-h-[40px]"
            title="Undo last scoring action"
          >
            <span className="material-symbols-outlined text-[16px]">undo</span>
            Undo
          </button>

          {/* Reset All */}
          <button
            type="button"
            onClick={handleResetAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold transition-colors cursor-pointer shadow-2xs min-h-[40px]"
            title="Reset match data"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            Reset
          </button>
        </div>

        {/* Big Action: Confirm Bout Result & Advance Tree */}
        <div className="flex items-center gap-3">
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
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-extrabold text-sm uppercase shadow-sm transition-all cursor-pointer active:scale-95 disabled:opacity-50 min-h-[44px]"
          >
            <span className="material-symbols-outlined text-[18px]">verified</span>
            Confirm Result & Advance Bracket
          </button>
        </div>
      </div>

      {/* Timer Configuration Modal (Minutes, Seconds & Milliseconds) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-neutral-200">
            <h3 className="font-extrabold text-lg text-neutral-900 mb-1">
              Match Clock Setting
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              Enter exact minutes, seconds, and milliseconds for the match countdown.
            </p>

            <div className="grid grid-cols-3 gap-3 mb-5">
              <div>
                <label className="block text-[10px] font-black uppercase text-neutral-500 mb-1">
                  Minutes
                </label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={editMinutes}
                  onChange={(e) => setEditMinutes(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-xl font-mono font-bold text-center text-lg"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-neutral-500 mb-1">
                  Seconds
                </label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={editSeconds}
                  onChange={(e) => setEditSeconds(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-xl font-mono font-bold text-center text-lg"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-neutral-500 mb-1">
                  Millisec
                </label>
                <input
                  type="number"
                  min="0"
                  max="999"
                  value={editMilliseconds}
                  onChange={(e) => setEditMilliseconds(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-xl font-mono font-bold text-center text-lg"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTimerSettings}
                className="px-5 py-2 rounded-xl bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-black text-xs uppercase shadow-sm cursor-pointer"
              >
                Save Clock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finish & Advance Confirmation Modal */}
      {showFinishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200">
            <h3 className="font-extrabold text-lg text-neutral-900 mb-1">
              Confirm Bout #{match.matchNo} Result
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              Select the winning competitor and decision method to advance the tournament bracket tree.
            </p>

            {/* Select Winner Cards */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                type="button"
                onClick={() => setSelectedWinnerSide("AKA")}
                className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                  selectedWinnerSide === "AKA"
                    ? "border-red-600 bg-red-50 ring-2 ring-red-500/20"
                    : "border-neutral-200 hover:border-neutral-300 bg-white"
                }`}
              >
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-red-600 text-white block w-max mb-1.5">
                  AKA (Red)
                </span>
                <p className="font-extrabold text-sm text-neutral-900 truncate">
                  {match.aka.name}
                </p>
                <p className="text-xs font-mono font-bold text-red-600 mt-1">
                  {akaPoints} Points
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedWinnerSide("AO")}
                className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                  selectedWinnerSide === "AO"
                    ? "border-blue-600 bg-blue-50 ring-2 ring-blue-500/20"
                    : "border-neutral-200 hover:border-neutral-300 bg-white"
                }`}
              >
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-blue-600 text-white block w-max mb-1.5">
                  AO (Blue)
                </span>
                <p className="font-extrabold text-sm text-neutral-900 truncate">
                  {match.ao.name}
                </p>
                <p className="text-xs font-mono font-bold text-blue-600 mt-1">
                  {aoPoints} Points
                </p>
              </button>
            </div>

            {/* Decision Method */}
            <div className="mb-5">
              <label className="block text-xs font-bold text-neutral-700 mb-1 uppercase tracking-wider">
                Decision Method
              </label>
              <select
                value={finishMethod}
                onChange={(e) => setFinishMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-neutral-300 bg-white text-sm font-semibold text-neutral-800 focus:outline-none focus:ring-2 focus:ring-[#0E9C7C]"
              >
                <option value="POINTS">Points Difference</option>
                <option value="SENSHU">First Uncontested Point (Senshu)</option>
                <option value="8_POINT_LEAD">8-Point Superiority Lead</option>
                <option value="HANTEI">Hantei (Judges' Decision)</option>
                <option value="KIKEN">Kiken (Injury / Forfeit)</option>
                <option value="HANSOKU">Hansoku (Disqualification)</option>
                <option value="SHIKKAKU">Shikkaku (Severe Misconduct DQ)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setShowFinishModal(false)}
                disabled={confirming}
                className="px-4 py-2 rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => selectedWinnerSide && handleConfirmWinner(selectedWinnerSide)}
                disabled={!selectedWinnerSide || confirming}
                className="px-5 py-2 rounded-xl bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-black text-xs uppercase shadow-sm cursor-pointer disabled:opacity-50"
              >
                {confirming ? "Advancing..." : "Confirm & Advance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hantei (Referee Flags) Modal */}
      {showHanteiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-neutral-200">
            <h3 className="font-extrabold text-base text-neutral-900 mb-1">
              Hantei (Referee Flags Decision)
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              When match ends tied and without Senshu, declare majority flag winner:
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedWinnerSide("AKA");
                  setFinishMethod("HANTEI");
                  setShowHanteiModal(false);
                  setShowFinishModal(true);
                }}
                className="p-4 rounded-xl border-2 border-red-600 hover:bg-red-50 text-center font-black text-sm text-red-600 uppercase cursor-pointer transition-colors"
              >
                🚩 AKA Flags
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedWinnerSide("AO");
                  setFinishMethod("HANTEI");
                  setShowHanteiModal(false);
                  setShowFinishModal(true);
                }}
                className="p-4 rounded-xl border-2 border-blue-600 hover:bg-blue-50 text-center font-black text-sm text-blue-600 uppercase cursor-pointer transition-colors"
              >
                🚩 AO Flags
              </button>
            </div>

            <div className="text-right">
              <button
                type="button"
                onClick={() => setShowHanteiModal(false)}
                className="text-xs font-bold text-neutral-500 hover:text-neutral-800"
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
