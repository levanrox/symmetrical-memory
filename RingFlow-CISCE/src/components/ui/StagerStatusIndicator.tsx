"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

interface StagerStatusIndicatorProps {
  stagerStatus: "calling" | "ready" | string;
  stagerActorName?: string | null;
}

export default function StagerStatusIndicator({
  stagerStatus,
  stagerActorName,
}: StagerStatusIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isCalling = stagerStatus === "calling";
  const label = isCalling
    ? (stagerActorName ? `Calling in progress by ${stagerActorName}` : "Calling in progress")
    : (stagerActorName ? `Ready - called by ${stagerActorName}` : "Ready - called");

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = tooltipRef.current?.offsetWidth || 210;
    const height = tooltipRef.current?.offsetHeight || 28;

    // Prefer below icon; flip above if not enough space near bottom of screen
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8 && rect.top - height - 6 > 0) {
      top = rect.top - height - 6;
    }

    // Align center with icon, clamp between screen edges with 10px margin
    let left = rect.left + rect.width / 2 - width / 2;
    if (left < 10) left = 10;
    if (left + width > window.innerWidth - 10) {
      left = window.innerWidth - width - 10;
    }

    setCoords({ top, left });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }

    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);

    const handleScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    const handleOutsideInteraction = (e: MouseEvent | TouchEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideInteraction);
    document.addEventListener("touchstart", handleOutsideInteraction);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      document.removeEventListener("mousedown", handleOutsideInteraction);
      document.removeEventListener("touchstart", handleOutsideInteraction);
    };
  }, [isOpen, updatePosition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsOpen((prev) => !prev);
        }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        aria-label={label}
        className={`w-5 h-5 rounded-full flex items-center justify-center transition-all cursor-pointer select-none shrink-0 ${isCalling
            ? "bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 active:scale-95 shadow-2xs"
            : "bg-green-100 text-green-800 border border-green-300 hover:bg-green-200 active:scale-95 shadow-2xs"
          }`}
      >
        <span
          className={`material-symbols-outlined text-[13px] leading-none ${isCalling ? "animate-pulse" : ""
            }`}
        >
          {isCalling ? "notifications_active" : "check_circle"}
        </span>
      </button>

      {/* Render via Portal to document.body so it is NEVER clipped by parent containers and ALWAYS on top */}
      {mounted && isOpen && coords &&
        createPortal(
          <div
            ref={tooltipRef}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            className="z-[9999] px-2.5 py-1 bg-neutral-900/95 backdrop-blur-xs text-white text-[11px] font-medium rounded-md shadow-2xl border border-white/10 whitespace-nowrap pointer-events-none transition-opacity duration-150 animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`material-symbols-outlined text-[12px] ${isCalling ? "text-amber-300" : "text-green-300"
                  }`}
              >
                {isCalling ? "notifications_active" : "check_circle"}
              </span>
              <span>{label}</span>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
