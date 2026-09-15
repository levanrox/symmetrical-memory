"use client";

import React, { useState, useEffect } from "react";

function CountUp({ end, duration = 1500 }: { end: number; duration?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number | null = null;
    let animationFrameId: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [end, duration]);

  return <>{count}</>;
}

export default function PublicStats() {
  return (
    <section className="bg-[#1B1815] text-[#F5F3EC] py-2 sm:py-3 md:py-3.5 border-b border-[#E1DDCF]/20 font-['Inter',sans-serif] relative">
      <div className="max-w-7xl 2xl:max-w-[1560px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 grid grid-cols-3 gap-2 sm:gap-6 items-center">
        <div className="flex items-center justify-center md:justify-start gap-2 sm:gap-3 text-left">
          <span className="font-['Bebas_Neue',sans-serif] text-2xl sm:text-3xl md:text-4xl text-[#F5F3EC] leading-none tracking-wider shrink-0">
            <CountUp end={28} />
          </span>
          <span className="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#A19C90] uppercase tracking-wider text-[9.5px] sm:text-[11px] md:text-xs leading-tight">
            Upcoming Events
          </span>
        </div>
        <div className="flex items-center justify-center gap-2 sm:gap-3 border-x border-white/10 px-2 sm:px-6 text-left">
          <span className="font-['Bebas_Neue',sans-serif] text-2xl sm:text-3xl md:text-4xl text-[#F5F3EC] leading-none tracking-wider shrink-0">
            <CountUp end={12} />
          </span>
          <span className="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#A19C90] uppercase tracking-wider text-[9.5px] sm:text-[11px] md:text-xs leading-tight">
            Active Cities
          </span>
        </div>
        <div className="flex items-center justify-center md:justify-end gap-2 sm:gap-3 text-left">
          <span className="font-['Bebas_Neue',sans-serif] text-2xl sm:text-3xl md:text-4xl text-[#F5F3EC] leading-none tracking-wider shrink-0">
            <CountUp end={4} />
          </span>
          <span className="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#A19C90] uppercase tracking-wider text-[9.5px] sm:text-[11px] md:text-xs leading-tight">
            Participating Regions
          </span>
        </div>
      </div>
    </section>
  );
}
