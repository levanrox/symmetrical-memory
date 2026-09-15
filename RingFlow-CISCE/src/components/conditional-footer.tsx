"use client";

import { usePathname } from "next/navigation";
import { FooterDemo } from "@/components/footer-demo";

export function ConditionalFooter() {
  const pathname = usePathname();

  // Don't render footer on admin, moderator, organiser, or stager dashboards to preserve full screen height
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/moderator") ||
    pathname.startsWith("/organiser") ||
    pathname.startsWith("/stager")
  ) {
    return null;
  }

  return <FooterDemo />;
}
