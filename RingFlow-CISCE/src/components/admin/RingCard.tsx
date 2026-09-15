import React from "react";
import { SegmentedProgressBar } from "@/components/ui/SegmentedProgressBar";

export type RingStatus = "Running" | "Paused" | "Completed" | "Empty";

export interface RingTimingData {
  startTime: number | null;
  isStarted: boolean;
  isRunning: boolean;
  isManuallyPaused: boolean;
  isAllCompleted: boolean;
  actualSeconds: number;
  expectedSeconds: number;
  diffSeconds: number;
}

interface RingCardProps {
  name: string;
  status: RingStatus;
  categoryName?: string;
  nextCategoryName?: string;
  ringOrder?: number;
  currentMatch?: number;
  totalMatches?: number;
  totalExpectedMatches?: number;
  divisionCount?: number;
  progressPercent?: number;
  estimatedFinish?: string;
  statusReason?: string;
  timing: RingTimingData;
  onTogglePause?: () => void;
  onResetTimer?: () => void;
  formatTimeTook: (seconds: number) => string;
  formatTimeExpected: (seconds: number) => string;
  readOnly?: boolean;
}

export default function RingCard({
  name,
  status,
  categoryName = "Pending Next Category",
  nextCategoryName,
  ringOrder,
  currentMatch = 0,
  totalMatches = 0,
  totalExpectedMatches = 0,
  divisionCount = 0,
  progressPercent = 0,
  estimatedFinish = "--:--",
  statusReason,
  timing,
  onTogglePause,
  onResetTimer,
  formatTimeTook,
  formatTimeExpected,
  readOnly = false,
}: RingCardProps) {
  // Status resolution matching public spectator floor
  const isRunning = status === "Running";
  const isPaused = status === "Paused";
  const isCompleted = status === "Completed";
  const isIdle = !isRunning && !isPaused && !isCompleted;

  const statusLabel = isRunning
    ? "RUNNING"
    : isPaused
    ? "PAUSED"
    : isCompleted
    ? "COMPLETED"
    : "IDLE";

  const bandBg = isRunning
    ? "bg-[#1F5C3B] animate-band-pulse"
    : isPaused
    ? "bg-[#8E2E27]"
    : isCompleted
    ? "bg-[#1E3A8A]"
    : "bg-[#59564C]";

  // Derive mat number (e.g., "01", "02") and title
  const matNum = ringOrder
    ? String(ringOrder).padStart(2, "0")
    : name.replace(/[^0-9]/g, "").padStart(2, "0") || "01";

  const subLabel = name.toLowerCase().includes("tatami")
    ? name
    : `Tatami ${matNum}`;

  return (
    <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs hover:shadow-md hover:border-slate-300 transition-all flex flex-col justify-between">
      {/* ─── Top Scoreboard Band ─── */}
      <div
        className={`relative flex items-center justify-between px-4 sm:px-5 py-3 h-[56px] text-white shrink-0 overflow-hidden ${bandBg}`}
      >
        {/* Left: Scoreboard Number & Sub-label */}
        <div className="flex items-baseline gap-2 relative z-10">
          <span className="font-scoreboard text-[28px] sm:text-[32px] font-normal leading-none tracking-wide text-white">
            {matNum}
          </span>
          <span className="text-[12px] font-medium text-white/80 tracking-normal">
            {subLabel}
          </span>
        </div>

        {/* Right: Dot Status Badge + Translucent Admin Controls */}
        <div className="flex items-center gap-2 relative z-10">
          <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-white">
            <span className="relative flex h-2 w-2 shrink-0">
              {isRunning && (
                <span className="animate-pulse-ring absolute inline-flex h-full w-full rounded-full bg-white opacity-80" />
              )}
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            <span>{statusLabel}</span>
          </span>

          {!readOnly && (
            <div className="flex items-center gap-1 ml-1.5">
              {onResetTimer && timing.isStarted && (
                <button
                  type="button"
                  onClick={onResetTimer}
                  title={`Reset ${name} timer`}
                  className="w-7 h-7 rounded-md bg-white/15 hover:bg-white/30 text-white flex items-center justify-center transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">restart_alt</span>
                </button>
              )}

              {onTogglePause && (
                <button
                  type="button"
                  onClick={onTogglePause}
                  title={
                    timing.isRunning
                      ? `Pause ${name} timer`
                      : timing.isManuallyPaused
                      ? `Resume ${name} timer`
                      : `Start ${name} timer`
                  }
                  className="w-7 h-7 rounded-md bg-white/20 hover:bg-white/35 text-white flex items-center justify-center transition-all cursor-pointer shadow-2xs"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {timing.isRunning ? "pause" : "play_arrow"}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Ticket Perforation Notches ─── */}
      <div className="spectator-notch left top-[49px]" />
      <div className="spectator-notch right top-[49px]" />

      {/* ─── Card Inner Body ─── */}
      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between bg-white">
        <div>
          {isIdle ? (
            <div className="py-2 mb-2">
              <p className="text-[13.5px] text-[#68645A] leading-relaxed">
                Mat is clear. Ready for the next scheduled division.
              </p>
            </div>
          ) : (
            <>
              {/* Category Title */}
              <h4
                className="font-bold text-[15px] text-[#1B1815] mb-2 leading-snug line-clamp-1"
                title={categoryName}
              >
                {categoryName}
              </h4>

              {/* 10-Segment Hatched Progress Bar */}
              <SegmentedProgressBar
                completed={currentMatch}
                total={totalMatches || 1}
                status={status}
                className="mb-3"
              />

              {/* Time Elapsed / Expected Block */}
              <div
                onClick={!readOnly && onTogglePause ? onTogglePause : undefined}
                title={
                  !readOnly && onTogglePause
                    ? timing.isRunning
                      ? "Click to pause timer"
                      : "Click to start/resume timer"
                    : undefined
                }
                className={`bg-white rounded-lg p-3 my-3 border border-slate-200 shadow-2xs transition-all ${
                  !readOnly && onTogglePause
                    ? "cursor-pointer hover:border-slate-300 hover:bg-slate-50/70"
                    : ""
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-label-caps text-[#68645A] uppercase tracking-wider font-semibold">
                    Time Elapsed / Expected
                  </span>
                  {timing.isStarted && (() => {
                    const diffMinutes = Math.round(timing.diffSeconds / 60);
                    return (
                      <span
                        className={`text-[10px] font-bold font-data-mono px-1.5 py-0.5 rounded ${
                          diffMinutes >= 1
                            ? "bg-amber-100 text-amber-800"
                            : diffMinutes <= -1
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-[#1B1815]"
                        }`}
                      >
                        {diffMinutes >= 1
                          ? `+${diffMinutes}m Behind`
                          : diffMinutes <= -1
                          ? `${Math.abs(diffMinutes)}m Ahead`
                          : "On Pace"}
                      </span>
                    );
                  })()}
                </div>

                <div className="flex items-baseline gap-2">
                  <span
                    className="font-data-mono text-xl font-bold text-[#1B1815] tracking-tight"
                    suppressHydrationWarning
                  >
                    {timing.isStarted ? formatTimeTook(timing.actualSeconds) : "-- : --"}
                  </span>
                  <span className="font-data-mono text-xs text-[#68645A]">
                    / {timing.expectedSeconds > 0 ? formatTimeExpected(timing.expectedSeconds) : "--"}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ─── Footer: Next Division & Estimated Finish ─── */}
        <div className="pt-2.5 mt-2 border-t border-dashed border-slate-200 flex justify-between items-baseline gap-2 text-xs">
          <div className="flex items-baseline gap-1.5 min-w-0 truncate">
            <span className="text-[10px] font-bold tracking-[0.08em] text-[#A19C90] uppercase shrink-0">
              NEXT
            </span>
            <span
              className={`text-[12px] truncate ${
                nextCategoryName ? "font-semibold text-[#1B1815]" : "font-normal text-[#A19C90]"
              }`}
            >
              {nextCategoryName || "No upcoming division queued"}
            </span>
          </div>

          <span className="font-data-mono text-[11px] text-[#68645A] shrink-0" suppressHydrationWarning>
            {isIdle ? (
              <span className="font-label-caps text-[10px] uppercase font-bold text-[#A19C90]">
                {divisionCount > 0 ? `${divisionCount} Queued` : "Standby"}
              </span>
            ) : (
              `Est. Finish: ${estimatedFinish}`
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

