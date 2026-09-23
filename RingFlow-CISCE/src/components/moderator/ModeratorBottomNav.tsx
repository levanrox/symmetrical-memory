"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getPendingJudgeCount } from "@/actions/judge";
import { useLiveEvents } from "@/hooks/useLiveEvents";

/**
 * Phone and tablet navigation: one-thumb reach at the bottom of the screen,
 * kept clear of the home indicator. Replaced by the header tabs from lg up.
 *
 * The Judges tab carries a live badge with the pending-approval count, so a
 * judge waiting at the desk is one tap away — the moderator never has to go
 * looking for approvals mid-bout.
 */
export default function ModeratorBottomNav({ ringId }: { ringId: string }) {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let alive = true;
    getPendingJudgeCount(ringId)
      .then((c) => {
        if (alive) setPendingCount(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ringId]);

  useLiveEvents(
    { ringId },
    () => {
      getPendingJudgeCount(ringId)
        .then(setPendingCount)
        .catch(() => {});
    },
    { debounceMs: 800 }
  );

  const tabs = [
    { key: "current", label: "Current", icon: "grid_view" },
    { key: "queue", label: "Queue", icon: "format_list_bulleted" },
    { key: "judges", label: "Judges", icon: "gavel", badge: pendingCount },
    { key: "controls", label: "Controls", icon: "settings_accessibility" },
  ];

  return (
    <nav
      aria-label="Tatami sections"
      className="fixed bottom-0 left-0 z-50 w-full rounded-t-xl border-t border-outline-variant bg-surface-container-highest/95 shadow-lg backdrop-blur-sm lg:hidden"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex w-full max-w-md items-center justify-around px-2 py-2.5">
        {tabs.map(({ key, label, icon, badge }) => {
          const active = pathname.includes(`/${key}`);
          return (
            <Link
              key={key}
              href={`/moderator/ring/${ringId}/${key}`}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[48px] min-w-[64px] flex-col items-center justify-center rounded-xl px-2 py-1.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 ${
                active
                  ? "bg-secondary-container/30 text-secondary scale-105"
                  : "text-on-surface-variant hover:bg-surface-container active:scale-95"
              }`}
            >
              <span
                className="material-symbols-outlined text-[22px]"
                style={{ fontVariationSettings: active ? '"FILL" 1' : '"FILL" 0' }}
              >
                {icon}
              </span>
              <span className={`mt-0.5 font-label-caps text-[11px] whitespace-nowrap ${active ? "font-bold" : ""}`}>
                {label}
              </span>
              {badge != null && badge > 0 && (
                <span
                  aria-label={`${badge} judges waiting for approval`}
                  className="absolute top-0.5 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[10px] font-black text-white"
                >
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
