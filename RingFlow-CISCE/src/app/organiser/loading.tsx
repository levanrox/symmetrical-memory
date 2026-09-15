import React from "react";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { TournamentCardSkeleton } from "@/components/ui/Skeleton";

export default function OrganiserSelectTournamentLoading() {
  return (
    <div className="min-h-screen bg-background flex flex-col w-full">
      <OrganiserHeader title="Select Tournament" />
      <div className="flex-1 overflow-y-auto p-margin-desktop bg-surface">
        <div className="max-w-7xl mx-auto w-full">
          {/* Welcome Section */}
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-label-caps font-bold tracking-wider uppercase bg-primary text-on-primary">
                Organiser Terminal
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface">
              Welcome
            </h1>
            <p className="text-body-sm text-on-surface-variant mt-1">
              Select an ongoing tournament to monitor live tatamis, category assignments, and athlete rosters.
            </p>
          </div>

          {/* Section Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary">sports_martial_arts</span>
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Available Tournaments</h3>
            </div>
          </div>

          {/* Tournament Grid Skeletons */}
          <div className="flex justify-center mb-16 gap-6 flex-wrap">
            <TournamentCardSkeleton />
            <TournamentCardSkeleton />
            <TournamentCardSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
