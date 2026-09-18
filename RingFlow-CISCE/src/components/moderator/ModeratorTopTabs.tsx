"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "current", label: "Current", icon: "grid_view" },
  { key: "queue", label: "Queue", icon: "format_list_bulleted" },
  { key: "controls", label: "Controls", icon: "settings_accessibility" },
];

/**
 * Laptop-and-up navigation. The bottom bar is a phone affordance; on a desk
 * the same three destinations live in the header where the pointer already is.
 */
export default function ModeratorTopTabs({ ringId }: { ringId: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Tatami sections" className="hidden items-center gap-1 rounded-xl border border-[#E1DDCF] bg-[#F5F3EC] p-1 lg:flex">
      {TABS.map(({ key, label, icon }) => {
        const active = pathname.includes(`/${key}`);
        return (
          <Link
            key={key}
            href={`/moderator/ring/${ringId}/${key}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
              active ? "bg-[#0E9C7C] text-white shadow-xs" : "text-[#68645A] hover:text-[#1B1815]"
            }`}
          >
            <span
              className="material-symbols-outlined text-[18px]"
              style={{ fontVariationSettings: active ? '"FILL" 1' : '"FILL" 0' }}
            >
              {icon}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
