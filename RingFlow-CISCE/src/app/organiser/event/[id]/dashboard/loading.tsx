import React from "react";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { StatsCardSkeleton, RingCardSkeleton } from "@/components/ui/Skeleton";

export default function OrganiserDashboardLoading() {
  return (
    <>
      <OrganiserHeader title="Overview" />
      
      <div className="p-margin-desktop space-y-8 pb-24 w-full">
        {/* Stats Grid Skeletons */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          <StatsCardSkeleton />
          <StatsCardSkeleton />
          <StatsCardSkeleton hasProgress={true} />
        </section>

        {/* Live Tatami Grid (Full Width for Organiser) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-headline-sm text-headline-sm text-primary font-bold">Live Tatami Status</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
            <RingCardSkeleton />
            <RingCardSkeleton />
            <RingCardSkeleton />
            <RingCardSkeleton />
            <RingCardSkeleton />
            <RingCardSkeleton />
          </div>
        </div>
      </div>
    </>
  );
}
