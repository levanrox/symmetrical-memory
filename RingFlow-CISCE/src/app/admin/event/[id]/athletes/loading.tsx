import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { AthleteListSkeleton, Skeleton } from "@/components/ui/Skeleton";

export default function AthletesLoading() {
  return (
    <>
      <AdminHeader title="Athletes Roster" />
      
      <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 sm:space-y-8 bg-surface pb-24 w-full">
        {/* Header Block */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h2 className="font-headline-sm text-headline-sm text-primary">Athlete Roster</h2>
            <p className="text-body-sm text-on-surface-variant">Manage athletes or drag-and-drop Excel files to bulk upload by category.</p>
          </div>
          <div className="flex gap-2 sm:gap-4 select-none opacity-50">
            <Skeleton className="h-9 w-40 rounded" />
            <Skeleton className="h-9 w-32 rounded" />
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
        <AthleteListSkeleton count={6} readOnly={false} />
      </div>
    </>
  );
}
