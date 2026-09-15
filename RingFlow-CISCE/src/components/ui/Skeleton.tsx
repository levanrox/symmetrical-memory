import React from "react";

// 1. Base Skeleton component with subtle pulse animation
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-surface-container-high rounded-md ${className}`} />
  );
}

// 2. Tournament Overview Card Skeleton (Select Tournament Page)
export function TournamentCardSkeleton() {
  return (
    <div className="w-full max-w-sm bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden flex flex-col h-[208px]">
      <div className="p-card-padding flex-grow">
        <div className="flex justify-between items-start mb-4">
          <Skeleton className="w-16 h-5" />
          <Skeleton className="w-16 h-4" />
        </div>
        <Skeleton className="w-3/4 h-6 mb-2" />
        <Skeleton className="w-1/2 h-4 mb-6" />
      </div>
      <div className="px-card-padding py-4 bg-surface-container-low border-t border-outline-variant flex justify-between items-center h-[53px]">
        <Skeleton className="w-24 h-4" />
        <Skeleton className="w-5 h-5 rounded-full" />
      </div>
    </div>
  );
}

// 3. Stats Card Skeleton (Total Categories, Completed Matches, etc.)
export function StatsCardSkeleton({ hasProgress = false }: { hasProgress?: boolean }) {
  return (
    <div className="bg-white p-card-padding border border-[#E1DDCF] rounded-lg flex flex-col justify-between shadow-xs min-h-[142px]">
      <div className="flex justify-between items-start">
        <Skeleton className="w-28 h-4" />
        <Skeleton className="w-6 h-6 rounded-full" />
      </div>
      {hasProgress ? (
        <div className="mt-6">
          <Skeleton className="w-full h-2 rounded-full mb-3" />
          <div className="flex justify-between">
            <Skeleton className="w-12 h-4" />
            <Skeleton className="w-16 h-4" />
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <Skeleton className="w-16 h-8 mb-2" />
          <Skeleton className="w-32 h-4" />
        </div>
      )}
    </div>
  );
}

// 4. Live Ring Status Card Skeleton (Dashboard View)
export function RingCardSkeleton() {
  return (
    <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col justify-between h-[250px]">
      <div className="bg-[#59564C]/15 px-5 py-3 h-[56px] flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Skeleton className="w-8 h-7" />
          <Skeleton className="w-16 h-4" />
        </div>
        <Skeleton className="w-16 h-4 rounded" />
      </div>

      <div className="spectator-notch left top-[49px]" />
      <div className="spectator-notch right top-[49px]" />

      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          <Skeleton className="w-3/4 h-5 mb-3" />
          <div className="flex gap-1 mb-2.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="flex-1 h-2 rounded-[1.5px]" />
            ))}
          </div>
          <div className="flex justify-between items-center mb-3">
            <Skeleton className="w-20 h-3" />
            <Skeleton className="w-8 h-3" />
          </div>
        </div>

        <div className="pt-2.5 border-t border-dashed border-slate-200 flex justify-between items-center">
          <Skeleton className="w-28 h-3" />
          <Skeleton className="w-16 h-3" />
        </div>
      </div>
    </div>
  );
}

// 5. Live Activity Feed Skeleton
export function LiveActivityFeedSkeleton() {
  return (
    <div className="bg-white border border-[#E7EAEF] rounded-xl shadow-2xs overflow-hidden">
      <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-[#E7EAEF]">
        <div className="flex items-center gap-2">
          <Skeleton className="w-2 h-2 rounded-full" />
          <Skeleton className="w-28 h-4" />
        </div>
        <Skeleton className="w-4 h-4" />
      </div>
      <div className="p-6 flex flex-col items-center justify-center">
        <Skeleton className="w-48 h-3.5" />
      </div>
    </div>
  );
}

// 6. Moderator Requests Widget Skeleton
export function ModeratorRequestsSkeleton() {
  return (
    <div className="bg-white border border-[#E7EAEF] rounded-xl shadow-2xs overflow-hidden">
      <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-[#E7EAEF]">
        <div className="flex items-center gap-2">
          <Skeleton className="w-5 h-5 rounded-md" />
          <Skeleton className="w-32 h-4" />
        </div>
        <Skeleton className="w-4 h-4" />
      </div>
      <div className="p-6 flex flex-col items-center justify-center">
        <Skeleton className="w-8 h-8 rounded-full mb-2" />
        <Skeleton className="w-40 h-4 mb-1.5" />
        <Skeleton className="w-52 h-3" />
      </div>
    </div>
  );
}

// 7. Generic Table Row Skeleton for loading tabular lists
export function TableRowSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <tr className="hover:bg-surface-container-low transition-colors">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <Skeleton 
            className={`h-5 ${
              i === 0 ? "w-32" : i === 1 ? "w-48" : i === 2 ? "w-24" : "w-16 ml-auto"
            }`} 
          />
        </td>
      ))}
    </tr>
  );
}

// 8. Ring Manager Card Skeleton (Ring Management Page)
export function RingManagerCardSkeleton() {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm flex flex-col justify-between h-[216px]">
      <div>
        <div className="flex justify-between items-start mb-4">
          <Skeleton className="w-24 h-6" />
          <Skeleton className="w-16 h-4" />
        </div>
        
        <div className="p-4 bg-surface-container-low border border-outline-variant rounded-lg mb-6 flex flex-col items-center">
          <Skeleton className="w-36 h-3 mb-2" />
          <Skeleton className="w-20 h-7" />
        </div>
      </div>
      
      <div className="flex gap-3">
        <Skeleton className="flex-1 h-8 rounded" />
      </div>
    </div>
  );
}

// 9. Public Dashboard Ring Card Skeleton
export function PublicRingCardSkeleton() {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden shadow-sm">
      <div className="bg-surface-container-highest text-on-surface px-5 py-3 flex justify-between items-center">
        <Skeleton className="w-24 h-6" />
        <Skeleton className="w-20 h-6 rounded-full" />
      </div>
      
      <div className="p-5">
        <div className="mb-4">
          <Skeleton className="w-48 h-6 mb-2" />
          <Skeleton className="w-36 h-4" />
        </div>
        
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            <Skeleton className="w-28 h-3" />
            <Skeleton className="w-32 h-3" />
          </div>
          <Skeleton className="h-1.5 w-full bg-surface-container rounded-full" />
        </div>
        
        <div className="bg-surface-container-low rounded-lg p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="w-8 h-3" />
            <Skeleton className="w-24 h-4" />
          </div>
          <Skeleton className="w-5 h-5 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// 10. Moderator Category Queue Item Skeleton
export function ModeratorQueueSkeleton() {
  return (
    <div className="p-4 bg-surface-container-lowest border border-outline-variant rounded-lg flex items-center justify-between shadow-sm">
      <div className="space-y-2">
        <Skeleton className="w-40 h-5" />
        <Skeleton className="w-24 h-4" />
      </div>
      <Skeleton className="w-12 h-6 rounded" />
    </div>
  );
}

// 11. Category List Skeleton (Responsive: Mobile Cards on <md, Desktop Table on >=md)
export function CategoryListSkeleton({ count = 6, readOnly = false }: { count?: number; readOnly?: boolean }) {
  return (
    <div>
      {/* Mobile Card List (< md) */}
      <div className="md:hidden space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="p-3.5 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xs space-y-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-3/4 rounded" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-16 rounded" />
                  <span className="text-outline-variant text-xs">•</span>
                  <Skeleton className="h-3.5 w-20 rounded" />
                </div>
              </div>
              <Skeleton className="h-5 w-16 rounded-full shrink-0" />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-outline-variant/40 text-xs">
              <Skeleton className="h-3.5 w-20 rounded" />
              <Skeleton className="h-3.5 w-16 rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table (>= md) */}
      <div className="hidden md:block bg-surface-container-lowest border border-outline-variant rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full text-left border-collapse table-fixed">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant w-[35%]">Name</th>
              <th className="px-4 py-4 font-label-caps text-label-caps text-on-surface-variant w-[15%]">Age</th>
              <th className="px-4 py-4 font-label-caps text-label-caps text-on-surface-variant w-[18%]">Weight</th>
              <th className="px-4 py-4 font-label-caps text-label-caps text-on-surface-variant text-center w-[16%]">Athletes</th>
              <th className="px-4 py-4 font-label-caps text-label-caps text-on-surface-variant text-center w-[16%]">Expected Matches</th>
              {!readOnly && (
                <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant text-right w-[15%]">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {Array.from({ length: count }).map((_, i) => (
              <tr key={i} className="hover:bg-surface-container-low transition-colors">
                <td className="px-6 py-4"><Skeleton className="h-4.5 w-3/4 rounded" /></td>
                <td className="px-4 py-4"><Skeleton className="h-4 w-16 rounded" /></td>
                <td className="px-4 py-4"><Skeleton className="h-4 w-20 rounded" /></td>
                <td className="px-4 py-4 flex justify-center"><Skeleton className="h-4 w-12 rounded" /></td>
                <td className="px-4 py-4 text-center"><Skeleton className="h-4 w-10 mx-auto rounded" /></td>
                {!readOnly && (
                  <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-12 ml-auto rounded" /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 12. Athlete List Skeleton (Responsive: Mobile Cards on <md, Desktop Table on >=md)
export function AthleteListSkeleton({ count = 6, readOnly = false }: { count?: number; readOnly?: boolean }) {
  return (
    <div>
      {/* Mobile Card List (< md) */}
      <div className="md:hidden space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="p-3.5 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xs space-y-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <Skeleton className="h-5 w-10 rounded font-data-mono shrink-0" />
                <Skeleton className="h-4.5 w-40 rounded" />
              </div>
              <Skeleton className="h-5 w-16 rounded shrink-0" />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-outline-variant/40 gap-2">
              <Skeleton className="h-3.5 w-36 rounded" />
              <Skeleton className="h-4 w-20 rounded-full shrink-0" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table (>= md) */}
      <div className="hidden md:block bg-surface-container-lowest border border-outline-variant rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant w-24">Chest No.</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Name</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">School</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant w-28">School Code</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant w-32">Sports ID</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Category</th>
              {!readOnly && (
                <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant text-right">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {Array.from({ length: count }).map((_, i) => (
              <tr key={i} className="hover:bg-surface-container-low transition-colors">
                <td className="px-6 py-4"><Skeleton className="h-4 w-12 rounded" /></td>
                <td className="px-6 py-4"><Skeleton className="h-4.5 w-36 rounded" /></td>
                <td className="px-6 py-4"><Skeleton className="h-4 w-28 rounded" /></td>
                <td className="px-6 py-4"><Skeleton className="h-4 w-16 rounded" /></td>
                <td className="px-6 py-4"><Skeleton className="h-4 w-20 rounded" /></td>
                <td className="px-6 py-4"><Skeleton className="h-4 w-24 rounded" /></td>
                {!readOnly && (
                  <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-12 ml-auto rounded" /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
