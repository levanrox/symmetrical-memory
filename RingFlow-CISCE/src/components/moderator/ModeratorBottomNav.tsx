"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Phone and tablet navigation: one-thumb reach at the bottom of the screen,
 * kept clear of the home indicator. Replaced by the header tabs from lg up.
 */
export default function ModeratorBottomNav({ ringId }: { ringId: string }) {
  const pathname = usePathname();

  const tabs = [
    { key: "current", label: "Current", icon: "grid_view" },
    { key: "queue", label: "Queue", icon: "format_list_bulleted" },
    { key: "controls", label: "Controls", icon: "settings_accessibility" },
  ];

  return (
    <nav
      aria-label="Tatami sections"
      className="fixed bottom-0 left-0 z-50 w-full rounded-t-xl border-t border-outline-variant bg-surface-container-highest shadow-lg lg:hidden"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex w-full max-w-md items-center justify-around px-4 py-3">
        {tabs.map(({ key, label, icon }) => {
          const active = pathname.includes(`/${key}`);
          return (
            <Link
              key={key}
              href={`/moderator/ring/${ringId}/${key}`}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[48px] min-w-[72px] flex-col items-center justify-center rounded-xl px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 ${
                active
                  ? "bg-secondary-container/30 text-secondary"
                  : "text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              <span
                className="material-symbols-outlined text-[24px]"
                style={{ fontVariationSettings: active ? '"FILL" 1' : '"FILL" 0' }}
              >
                {icon}
              </span>
              <span className={`mt-1 font-label-caps text-[10px] whitespace-nowrap ${active ? "font-bold" : ""}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
