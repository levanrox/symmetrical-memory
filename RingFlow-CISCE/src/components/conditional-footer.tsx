"use client";

import { usePathname } from "next/navigation";
import { FooterDemo } from "@/components/footer-demo";

export function ConditionalFooter() {
  const pathname = usePathname();

  // Don't render the footer on full-height operational screens: the dashboards,
  // the arena scoreboard (mirrored onto a TV), and the judge phone UI (/j/*),
  // which needs every pixel for touch targets.
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/moderator") ||
    pathname.startsWith("/organiser") ||
    pathname.startsWith("/stager") ||
    pathname.startsWith("/scoreboard") ||
    pathname.startsWith("/j")
  ) {
    return null;
  }

  return <FooterDemo />;
}
