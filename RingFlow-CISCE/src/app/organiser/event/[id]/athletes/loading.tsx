import React from "react";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { AthleteListSkeleton, Skeleton } from "@/components/ui/Skeleton";

export default function OrganiserAthletesLoading() {
  return (
    <>
      <OrganiserHeader title="Athletes Roster" />

      <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 sm:space-y-8 bg-surface pb-24 w-full">
        {/* Header Block */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="font-headline-sm text-headline-sm text-primary">Athlete Roster</h2>
            <p className="text-body-sm text-on-surface-variant">View registered athletes and category assignments.</p>
          </div>
        </div>

        {/* Filters Shell */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4 select-none pointer-events-none opacity-60">
          <div className="flex-1 bg-[#FAF9F5] border border-outline-variant rounded-lg p-2 flex items-center gap-2">
            <Skeleton className="w-4 h-4 rounded-full shrink-0" />
            <Skeleton className="w-48 h-4 rounded" />
          </div>
          <div className="w-full sm:w-64 bg-[#FAF9F5] border border-outline-variant rounded-lg p-2 flex items-center justify-between">
            <Skeleton className="w-28 h-4 rounded" />
            <Skeleton className="w-4 h-4 rounded" />
          </div>
        </div>

        {/* Responsive Athletes Skeletons (Cards on Mobile, Table on Desktop) */}
        <AthleteListSkeleton count={6} readOnly={true} />
      </div>
    </>
  );
}
