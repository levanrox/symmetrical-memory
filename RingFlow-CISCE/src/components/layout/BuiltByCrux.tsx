"use client";

import React, { useState, useEffect, useRef } from "react";

interface BuiltByCruxProps {
  className?: string;
  imageHeightClass?: string;
}

const TARGET_TEXT = "BUILT BY";
const DIGITS = "0123456789";
const DECRYPT_DURATION = 2000;
const CYCLE_INTERVAL = 20000;

export default function BuiltByCrux({
  className = "",
  imageHeightClass = "h-[17px]",
}: BuiltByCruxProps) {
  const [displayText, setDisplayText] = useState(TARGET_TEXT);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isArrowPulsing, setIsArrowPulsing] = useState(false);
  const [isAmbientActive, setIsAmbientActive] = useState(false);

  const cycleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const triggerAnimation = () => {
      setIsAmbientActive(true);
      setIsDecrypting(true);
      const startTime = Date.now();

      if (animIntervalRef.current) clearInterval(animIntervalRef.current);

      animIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / DECRYPT_DURATION);
        const resolvedCount = Math.floor(progress * TARGET_TEXT.length);

        let result = "";
        for (let i = 0; i < TARGET_TEXT.length; i++) {
          if (TARGET_TEXT[i] === " ") {
            result += " ";
          } else if (i < resolvedCount) {
            result += TARGET_TEXT[i];
          } else {
            result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
          }
        }

        setDisplayText(result);

        if (progress >= 1) {
          if (animIntervalRef.current) clearInterval(animIntervalRef.current);
          setDisplayText(TARGET_TEXT);
          setIsDecrypting(false);
          setIsArrowPulsing(true);

          setTimeout(() => {
            setIsArrowPulsing(false);
            setIsAmbientActive(false);
          }, 700);
        }
      }, 45);
    };

    // Trigger preview shortly after load so user sees it right away
    const initialTimeout = setTimeout(() => {
      triggerAnimation();
    }, 2000);

    // Repeat every 20 seconds
    cycleTimerRef.current = setInterval(() => {
      triggerAnimation();
    }, CYCLE_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
      if (animIntervalRef.current) clearInterval(animIntervalRef.current);
    };
  }, []);

  return (
    <div className={`relative self-stretch flex items-center shrink-0 ${className}`}>
      {/* ─── Ambient attention gradient from the right edge: strictly restricted to navbar bounds ─── */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 -right-3.5 sm:-right-6 w-48 sm:w-96 max-w-[75vw] bg-gradient-to-l from-slate-900/50 via-slate-800/25 to-transparent transition-opacity duration-500 ease-out z-0 overflow-hidden ${
          isAmbientActive ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* ─── Badge Anchor Link ─── */}
      <a
        href="https://cruxstudios.dev"
        target="_blank"
        rel="noopener noreferrer"
        className={`group relative z-10 flex items-center text-[#0F172A] transition-all duration-200 shrink-0 py-1 cursor-pointer ${className}`}
        title="Visit Crux Studios"
      >
        <div className="flex flex-col text-left leading-none gap-0.5">
          <div className="flex items-center gap-1">
            <span
              className={`font-['Inter',sans-serif] text-[8.5px] font-semibold tracking-[0.14em] uppercase transition-colors duration-150 select-none ${
                isDecrypting
                  ? "text-[#1D4ED8]"
                  : "text-[#64748B] group-hover:text-[#1D4ED8]"
              }`}
            >
              {displayText}
            </span>
            <svg
              className={`w-3 h-3 transition-all duration-150 shrink-0 ${
                isArrowPulsing
                  ? "animate-arrow-pulse"
                  : isDecrypting
                  ? "text-[#1D4ED8]"
                  : "text-[#94A3B8] group-hover:text-[#1D4ED8] group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
          </div>
          <img
            src="/crux-studios.png"
            alt="Crux Studios"
            className={`${imageHeightClass} w-auto object-contain shrink-0 mix-blend-multiply group-hover:drop-shadow-[0_0_8px_rgba(0,180,216,0.5)] transition-all duration-200`}
          />
        </div>
      </a>
    </div>
  );
}
