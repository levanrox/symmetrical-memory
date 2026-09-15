import React from "react";

interface SegmentedProgressBarProps {
  completed: number;
  total: number;
  status?: string;
  className?: string;
  showLabel?: boolean;
  compact?: boolean;
}

export function SegmentedProgressBar({
  completed,
  total,
  status = "running",
  className = "",
  showLabel = true,
  compact = false,
}: SegmentedProgressBarProps) {
  const safeTotal = Math.max(1, total);
  const safeCompleted = Math.min(safeTotal, Math.max(0, completed));
  const pct = Math.round((safeCompleted / safeTotal) * 100);
  const filled = Math.min(10, Math.round((safeCompleted / safeTotal) * 10));

  const normalizedStatus = status.toLowerCase();
  const isPaused = normalizedStatus === "paused";
  const isCompleted = normalizedStatus === "completed";

  const filledClass = isPaused
    ? "spectator-tile filled filled-pause"
    : isCompleted
    ? "spectator-tile filled filled-completed"
    : "spectator-tile filled filled-run";

  return (
    <div className={`w-full ${className}`}>
      {/* 10-tile segmented bar */}
      <div className={`spectator-tiles ${compact ? "mb-1" : "mb-1.5"}`}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={i < filled ? filledClass : "spectator-tile"}
            style={compact ? { height: "5px" } : undefined}
          />
        ))}
      </div>

      {/* Progress Label */}
      {showLabel && (
        <div className="flex items-center justify-between text-[10.5px] text-[#68645A]">
          <span className="font-medium text-[#1B1815]">
            Match <span className="font-bold font-data-mono">{safeCompleted}</span> of{" "}
            <span className="font-bold font-data-mono">{safeTotal}</span>
          </span>
          <span className="font-bold font-data-mono text-[#1B1815]">{pct}%</span>
        </div>
      )}
    </div>
  );
}

export default SegmentedProgressBar;
