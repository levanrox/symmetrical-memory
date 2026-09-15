"use client";

import React, { useEffect } from "react";
import { RingCardSkeleton } from "@/components/ui/Skeleton";
import "@/components/public/public-spectator.css";

export default function PublicEventLoading() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  return (
    <div className="spectator-root min-h-screen">
      <script dangerouslySetInnerHTML={{ __html: "window.scrollTo(0, 0);" }} />
      <div className="spectator-page">
        {/* ---------- Header Skeleton ---------- */}
        <header className="spectator-header">
          <div className="spectator-header__top">
            <div className="spectator-back-link opacity-70">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              All events
            </div>

            <div className="spectator-live-chip opacity-80">
              <span className="spectator-beacon animate-pulse" />
              LIVE FLOOR
            </div>
          </div>

          {/* Eyebrow & Title */}
          <div className="w-40 h-3 bg-[#E1DDCF]/80 rounded-sm animate-pulse mb-1.5" />
          <div className="w-full max-w-xl h-9 sm:h-11 bg-[#E1DDCF]/90 rounded-lg animate-pulse mb-0" />
        </header>

        {/* ---------- Search Box Skeleton ---------- */}
        <div className="spectator-search-wrap mb-7">
          <div className="spectator-search-box flex items-center px-4 gap-3 bg-white border border-[#E1DDCF] rounded-xl shadow-2xs h-[54px]">
            <svg
              className="w-5 h-5 text-[#A19C90] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <div className="w-72 max-w-[70%] h-4 bg-[#E1DDCF]/70 rounded animate-pulse" />
          </div>
        </div>

        {/* ---------- Section Head ---------- */}
        <div className="spectator-section-head">
          <span className="spectator-section-title">Tournament floor</span>
          <div className="spectator-legend">
            <span className="spectator-legend-item">
              <span className="spectator-legend-dot run" />
              Running
            </span>
            <span className="spectator-legend-item">
              <span className="spectator-legend-dot pause" />
              Paused
            </span>
            <span className="spectator-legend-item">
              <span className="spectator-legend-dot idle" />
              Idle
            </span>
          </div>
        </div>

        {/* ---------- Mat Grid Skeleton (Expansive responsive auto-fill grid) ---------- */}
        <div className="spectator-mat-grid" id="mat-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <RingCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
