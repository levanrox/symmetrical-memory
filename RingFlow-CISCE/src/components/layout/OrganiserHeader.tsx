"use client";

import React from "react";
import { useParams, usePathname } from "next/navigation";
import HeaderSearchBar from "@/components/layout/HeaderSearchBar";
import BuiltByCrux from "@/components/layout/BuiltByCrux";

export default function OrganiserHeader({
  title,
  eventName,
  showSearch,
  tournamentId,
}: {
  title: string;
  eventName?: string;
  showSearch?: boolean;
  tournamentId?: string;
}) {
  const params = useParams();
  const pathname = usePathname();
  const id = tournamentId || ((params?.id as string) || "");

  const isDashboard = showSearch !== undefined
    ? showSearch
    : Boolean(id && (pathname?.includes("/dashboard") || title?.toLowerCase() === "overview"));

  return (
    <header className="flex-shrink-0 bg-[#FAF9F5] border-b border-[#E1DDCF] sticky top-0 z-50">
      <div className="h-[60px] flex items-center justify-between px-4 sm:px-6 gap-3 sm:gap-6">
        {/* ─── Left: Breadcrumb ─── */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[13.5px] min-w-0">
          <span
            title={eventName || "RingFlow"}
            className="text-[#94A3B8] font-medium truncate max-w-[80px] min-[380px]:max-w-[105px] sm:max-w-[200px] md:max-w-[260px]"
          >
            {eventName || "RingFlow"}
          </span>
          <svg
            className="w-3.5 h-3.5 text-[#94A3B8] shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span className="text-[#0F172A] font-semibold truncate shrink-0">{title}</span>
        </div>

        {/* ─── Center: Live Interactive Search Bar (Dashboard only on Desktop) ─── */}
        {isDashboard && (
          <HeaderSearchBar tournamentId={id} role="organiser" className="hidden md:flex" />
        )}

        {/* ─── Right: Built by Crux Studios Badge ─── */}
        <div className="flex items-center shrink-0 ml-auto self-stretch">
          <BuiltByCrux />
        </div>
      </div>
    </header>
  );
}
