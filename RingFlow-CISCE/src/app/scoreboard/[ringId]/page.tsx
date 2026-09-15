"use client";

import React, { useEffect, useState, useCallback, useRef, use } from "react";
import { getRingActiveBout } from "@/actions/matches";
import { DrawBracketModal } from "@/components/draw/DrawBracketModal";

interface PageProps {
  params: Promise<{ ringId: string }>;
}

export default function ScoreboardPage({ params }: PageProps) {
  const { ringId } = use(params);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [clockMs, setClockMs] = useState<number>(180000);
  const [isDrawModalOpen, setIsDrawModalOpen] = useState(false);

  // Stable ref to current ring data so the smooth tick can always read latest values
  const ringRef = useRef<any>(null);

  const computeClockMs = useCallback((ring: any): number => {
    if (!ring) return 180000;
    const totalMs = (ring.matchDurationSeconds || 180) * 1000;

    if (ring.timerStatus === "running" && ring.timerStartedAt) {
      // timerStartedAt is a virtual origin: shifted back by elapsed ms.
      // remaining = totalDuration - (now - virtualOrigin)
      const origin = new Date(ring.timerStartedAt).getTime();
      return Math.max(0, totalMs - (Date.now() - origin));
    }

    if (ring.timerStatus === "paused") {
      // timerAccumulatedSeconds = ELAPSED seconds
      const elapsedMs = (ring.timerAccumulatedSeconds || 0) * 1000;
      return Math.max(0, totalMs - elapsedMs);
    }

    if (ring.timerStatus === "finished") return 0;

    // idle / null → show full duration
    return totalMs;
  }, []);

  const fetchBout = useCallback(async () => {
    try {
      const res = await getRingActiveBout(ringId);
      setData(res);
      ringRef.current = res?.ring ?? null;

      // Snap clock to server truth on every poll
      setClockMs(computeClockMs(res?.ring));
    } catch (err) {
      console.error("Scoreboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [ringId, computeClockMs]);

  // Poll DB every 1.5 s
  useEffect(() => {
    fetchBout();
    const interval = setInterval(fetchBout, 1500);
    return () => clearInterval(interval);
  }, [fetchBout]);

  // Smooth 50ms tick between polls — only when running.
  // Reads from ringRef so it always has the latest timerStartedAt without re-subscribing.
  useEffect(() => {
    if (data?.ring?.timerStatus !== "running") return;

    const tick = setInterval(() => {
      setClockMs(computeClockMs(ringRef.current));
    }, 50);
    return () => clearInterval(tick);
  }, [data?.ring?.timerStatus, computeClockMs]);

  const formatClock = (ms: number) => {
    const safeMs = Math.max(0, Math.floor(ms));
    const totalSeconds = Math.floor(safeMs / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    const millis = safeMs % 1000;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${millis
      .toString()
      .padStart(3, "0")}`;
  };

  if (loading && !data) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#141210] text-white">
        <span className="w-12 h-12 border-4 border-[#0E9C7C] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-extrabold text-lg tracking-widest uppercase text-neutral-400">
          Connecting to Arena Tatami Display...
        </p>
      </div>
    );
  }

  const category = data?.category;
  const currentMatch = data?.currentMatch;
  const ring = data?.ring;
  const isDrawEnabled = data?.tournament?.showPublicDraws ?? true;

  const akaPoints = currentMatch?.akaScore ?? 0;
  const aoPoints = currentMatch?.aoScore ?? 0;
  const akaPenalties = currentMatch?.akaPenalties ?? 0;
  const aoPenalties = currentMatch?.aoPenalties ?? 0;
  const senshu = currentMatch?.senshu ?? null;
  const isDecided = currentMatch?.status === "CONFIRMED";
  const akaWon = isDecided && currentMatch?.winnerId && currentMatch.winnerId === currentMatch.aka?.id;
  const aoWon = isDecided && currentMatch?.winnerId && currentMatch.winnerId === currentMatch.ao?.id;

  const timerLabel =
    ring?.timerStatus === "running" ? "LIVE" :
    ring?.timerStatus === "paused" ? "STOPPED" :
    ring?.timerStatus === "finished" ? "FINISHED" : "IDLE";

  return (
    <div className="h-screen w-screen bg-[#110F0E] text-white flex flex-col overflow-hidden font-sans select-none">
      {/* Top Arena Header */}
      <header className="h-20 bg-[#1A1816] border-b border-[#2C2824] px-8 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <span className="px-3 py-1 rounded-lg bg-[#0E9C7C] text-white font-black text-xs tracking-wider uppercase shadow-xs">
              {ring?.name || "TATAMI 1"}
            </span>
          </div>

          <div>
            <h1 className="font-black text-xl sm:text-2xl tracking-wide uppercase text-white">
              {category?.name || "Official Tournament Category"}
            </h1>
            <p className="text-xs font-bold text-[#8C877C] uppercase tracking-wider">
              {currentMatch ? `Bout #${currentMatch.matchNo} · ${currentMatch.roundName}` : "Waiting for Next Bout"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {isDrawEnabled && category?.id && (
            <button
              type="button"
              onClick={() => setIsDrawModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-95 border border-neutral-700 hover:border-[#0E9C7C] text-neutral-200 font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition-all shadow-md cursor-pointer"
              title="View Tournament Draw Bracket"
            >
              <span className="material-symbols-outlined text-[16px] text-[#0E9C7C]">account_tree</span>
              <span>View Draw</span>
            </button>
          )}

          <div className="text-right">
            <span className="font-mono text-xs font-bold text-[#8C877C] tracking-widest uppercase">
              RingFlow OVR v2.0
            </span>
            <p className="text-xs font-black text-[#0E9C7C] tracking-wider uppercase">
              LIVE ARENA FEED
            </p>
          </div>
        </div>
      </header>

      {/* Main Scoreboard Arena Display */}
      <main className="flex-1 grid grid-cols-12 divide-x divide-[#2C2824] relative">
        {/* AKA Column (5 cols) */}
        <section className="col-span-5 flex flex-col justify-between p-8 sm:p-12 bg-gradient-to-br from-[#DC2626]/15 via-transparent to-transparent">
          <div className="w-full flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="px-5 py-1.5 rounded-full bg-[#DC2626] text-white font-black text-sm sm:text-base tracking-widest uppercase shadow-lg">
                AKA (RED)
              </span>
              {currentMatch?.aka?.chestNumber && (
                <span className="px-3 py-1 rounded-lg bg-black/50 border border-neutral-700 text-neutral-300 font-mono font-bold text-xs">
                  #{currentMatch.aka.chestNumber}
                </span>
              )}
            </div>

            {senshu === "AKA" && (
              <span className="px-3.5 py-1 rounded-full bg-amber-400 text-amber-950 font-black text-xs uppercase tracking-wider shadow-md animate-pulse">
                ★ SENSHU
              </span>
            )}
          </div>

          <div className="my-auto">
            <h2 className="font-black text-4xl sm:text-5xl lg:text-6xl text-white tracking-tight uppercase mb-2 truncate">
              {currentMatch?.aka?.name || "Competitor TBD"}
            </h2>
            <p className="font-bold text-lg sm:text-xl text-[#0E9C7C] tracking-wider uppercase truncate">
              {currentMatch?.aka?.school || "Dojo / School"}
            </p>
          </div>

          <div>
            <div className={`w-full h-44 sm:h-52 rounded-3xl border-4 border-[#DC2626] bg-[#1A1816] flex items-center justify-center shadow-2xl mb-6 ${akaWon ? "ring-4 ring-emerald-500 bg-emerald-950/20" : ""}`}>
              <span className="font-mono font-black text-8xl sm:text-9xl lg:text-[10rem] text-[#DC2626] leading-none">
                {akaWon ? "WIN" : akaPoints}
              </span>
            </div>

            <div className="bg-black/40 border border-neutral-800 rounded-2xl p-3 flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-red-500">WARNING</span>
              <div className="flex gap-2">
                {[
                  { level: 1, label: "1" },
                  { level: 2, label: "2" },
                  { level: 3, label: "3" },
                  { level: 4, label: "HC" },
                  { level: 5, label: "H" },
                ].map(({ level, label }) => (
                  <div
                    key={level}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs border ${
                      akaPenalties >= level
                        ? "bg-red-600 border-red-500 text-white shadow-xs"
                        : "bg-neutral-900 border-neutral-800 text-neutral-600"
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Center Arena Hub (2 cols) */}
        <section className="col-span-2 flex flex-col items-center justify-center p-4 bg-[#141210]">
          <div className="text-center mb-8">
            <span className="font-black text-lg tracking-widest text-[#0E9C7C] uppercase block">RINGFLOW</span>
            <span className="text-[10px] font-bold text-neutral-500 tracking-wider uppercase">WKF OVR</span>
          </div>

          {/* Giant Center Match Clock */}
          <div className="w-full bg-[#1A1816] border-2 border-neutral-800 rounded-2xl p-4 text-center shadow-2xl mb-8">
            <span className="text-[10px] font-black tracking-widest uppercase text-neutral-500 block mb-1">MATCH CLOCK</span>
            <span
              className={`font-mono font-black text-3xl sm:text-4xl lg:text-5xl tracking-wider block ${
                clockMs <= 15000 && clockMs > 0
                  ? "text-amber-400 animate-pulse"
                  : clockMs === 0
                  ? "text-red-500"
                  : "text-[#F5E97A]"
              }`}
            >
              {formatClock(clockMs)}
            </span>
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mt-1 block">
              {timerLabel}
            </span>
          </div>

          {/* Bout Status Badge */}
          <div className="text-center">
            <span
              className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                isDecided
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-700"
                  : currentMatch?.status === "LIVE"
                  ? "bg-amber-950 text-amber-300 border border-amber-700 animate-pulse"
                  : "bg-neutral-800 text-neutral-300 border border-neutral-700"
              }`}
            >
              {isDecided ? "DECIDED" : currentMatch?.status || "READY"}
            </span>
          </div>
        </section>

        {/* AO Column (5 cols) */}
        <section className="col-span-5 flex flex-col justify-between p-8 sm:p-12 bg-gradient-to-bl from-[#2563EB]/15 via-transparent to-transparent">
          <div className="w-full flex justify-between items-center">
            {senshu === "AO" ? (
              <span className="px-3.5 py-1 rounded-full bg-amber-400 text-amber-950 font-black text-xs uppercase tracking-wider shadow-md animate-pulse">
                ★ SENSHU
              </span>
            ) : <div />}

            <div className="flex items-center gap-2">
              {currentMatch?.ao?.chestNumber && (
                <span className="px-3 py-1 rounded-lg bg-black/50 border border-neutral-700 text-neutral-300 font-mono font-bold text-xs">
                  #{currentMatch.ao.chestNumber}
                </span>
              )}
              <span className="px-5 py-1.5 rounded-full bg-[#2563EB] text-white font-black text-sm sm:text-base tracking-widest uppercase shadow-lg">
                AO (BLUE)
              </span>
            </div>
          </div>

          <div className="my-auto text-right">
            <h2 className="font-black text-4xl sm:text-5xl lg:text-6xl text-white tracking-tight uppercase mb-2 truncate">
              {currentMatch?.ao?.name || "Competitor TBD"}
            </h2>
            <p className="font-bold text-lg sm:text-xl text-[#0E9C7C] tracking-wider uppercase truncate">
              {currentMatch?.ao?.school || "Dojo / School"}
            </p>
          </div>

          <div>
            <div className={`w-full h-44 sm:h-52 rounded-3xl border-4 border-[#2563EB] bg-[#1A1816] flex items-center justify-center shadow-2xl mb-6 ${aoWon ? "ring-4 ring-emerald-500 bg-emerald-950/20" : ""}`}>
              <span className="font-mono font-black text-8xl sm:text-9xl lg:text-[10rem] text-[#2563EB] leading-none">
                {aoWon ? "WIN" : aoPoints}
              </span>
            </div>

            <div className="bg-black/40 border border-neutral-800 rounded-2xl p-3 flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-blue-400">WARNING</span>
              <div className="flex gap-2">
                {[
                  { level: 1, label: "1" },
                  { level: 2, label: "2" },
                  { level: 3, label: "3" },
                  { level: 4, label: "HC" },
                  { level: 5, label: "H" },
                ].map(({ level, label }) => (
                  <div
                    key={level}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs border ${
                      aoPenalties >= level
                        ? "bg-blue-600 border-blue-500 text-white shadow-xs"
                        : "bg-neutral-900 border-neutral-800 text-neutral-600"
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Bottom Ticker Bar */}
      <footer className="h-14 bg-[#1A1816] border-t border-[#2C2824] px-8 flex items-center justify-between text-xs text-[#8C877C]">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0E9C7C] animate-pulse" />
            TATAMI STREAM ACTIVE
          </span>
          <span>CURRENT EVENT: {category?.name || "Kumite"}</span>
        </div>
        <div>
          <span>Official CISCE Tournament Arena Display · RingFlow Digital Tatami</span>
        </div>
      </footer>

      {isDrawModalOpen && category?.id && (
        <DrawBracketModal
          categoryId={category.id}
          categoryName={category.name || "Tournament Category"}
          isOpen={isDrawModalOpen}
          onClose={() => setIsDrawModalOpen(false)}
        />
      )}
    </div>
  );
}
