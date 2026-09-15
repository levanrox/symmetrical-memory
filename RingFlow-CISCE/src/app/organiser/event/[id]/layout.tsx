import React from "react";
import OrganiserSidebar from "@/components/layout/OrganiserSidebar";

export default function OrganiserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background text-on-surface w-full">
      <OrganiserSidebar />
      <div className="flex-1 flex flex-col min-w-0 w-full pb-16 md:pb-0">
        {children}
      </div>
    </div>
  );
}
