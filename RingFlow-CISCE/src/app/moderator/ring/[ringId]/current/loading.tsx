import React from "react";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ModeratorCurrentLoading() {
  return (
    <div className="space-y-0">
      {/* Header Skeleton — compact */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Skeleton className="w-16 h-7 rounded" />
          <Skeleton className="w-16 h-6 rounded-full" />
        </div>
      </div>

      {/* Category Card Skeleton — compact banner */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 shadow-sm relative overflow-hidden mb-4">
        <div className="absolute top-0 left-0 w-1 h-full bg-outline"></div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="w-3/5 h-5" />
              <Skeleton className="w-12 h-4" />
            </div>
            <Skeleton className="w-full h-1.5 rounded-full" />
          </div>
          <Skeleton className="w-9 h-9 rounded-full shrink-0" />
        </div>
      </div>

      {/* Controls toolbar skeleton */}
      <div className="flex items-center gap-1.5 mb-3">
        <Skeleton className="w-28 h-9 rounded-lg" />
        <Skeleton className="w-16 h-9 rounded-lg" />
        <Skeleton className="w-24 h-9 rounded-lg" />
      </div>

      {/* Scoring pad skeleton — clock bar */}
      <div className="rounded-2xl border border-[#E1DDCF] bg-[#FAF9F5] shadow-sm overflow-hidden mb-6">
        <div className="bg-[#1B1815] px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="w-14 h-5 rounded-full bg-neutral-700" />
                <Skeleton className="w-20 h-4 bg-neutral-700" />
              </div>
              <Skeleton className="w-32 h-4 bg-neutral-700" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="w-20 h-10 rounded-lg bg-neutral-700" />
              <Skeleton className="w-16 h-10 rounded-lg bg-neutral-700" />
            </div>
          </div>
        </div>

        {/* Two competitor panels */}
        <div className="grid grid-cols-2 gap-2 p-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border-2 border-outline-variant bg-white p-2">
              <Skeleton className="w-10 h-4 rounded mb-1.5" />
              <Skeleton className="w-3/4 h-3 rounded mb-1" />
              <Skeleton className="w-full h-12 rounded-lg mb-1.5" />
              <div className="grid grid-cols-3 gap-1 mb-1">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
              <div className="grid grid-cols-5 gap-0.5">
                {[...Array(5)].map((_, j) => (
                  <Skeleton key={j} className="h-8 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Action bar */}
        <div className="border-t border-[#E1DDCF] px-2 py-2 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1.5">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <Skeleton className="w-10 h-10 rounded-lg" />
            <Skeleton className="w-10 h-10 rounded-lg" />
          </div>
          <Skeleton className="w-24 h-11 rounded-xl" />
        </div>
      </div>

      {/* Pause/Resume Button Skeleton */}
      <Skeleton className="w-full h-12 rounded-xl" />
    </div>
  );
}
