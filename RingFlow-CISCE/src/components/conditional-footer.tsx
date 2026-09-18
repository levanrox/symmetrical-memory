"use client";

import { usePathname } from "next/navigation";
import { FooterDemo } from "@/components/footer-demo";

export function ConditionalFooter() {
  const pathname = usePathname();

  // Don't render the footer on full-height operational screens: the dashboards
  // and the arena scoreboard, which is mirrored onto a TV.
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/moderator") ||
    pathname.startsWith("/organiser") ||
    pathname.startsWith("/stager") ||
    pathname.startsWith("/scoreboard")
  ) {
    return null;
  }

  return <FooterDemo />;
}
