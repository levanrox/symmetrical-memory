import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { CategoryListSkeleton, Skeleton } from "@/components/ui/Skeleton";

export default function CategoriesLoading() {
  return (
    <>
      <AdminHeader title="Categories" />
      
      <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 sm:space-y-8 bg-surface pb-24 w-full">
        {/* Header Block */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h2 className="font-headline-sm text-headline-sm text-primary">Division Management</h2>
            <p className="text-body-sm text-on-surface-variant">View and manage categories for this tournament.</p>
          </div>
          <div className="flex gap-2 sm:gap-4 select-none opacity-50">
            <Skeleton className="h-9 w-36 rounded" />
            <Skeleton className="h-9 w-32 rounded" />
          </div>
        </div>

        {/* Responsive Categories Skeletons (Cards on Mobile, Table on Desktop) */}
        <CategoryListSkeleton count={6} readOnly={false} />
      </div>
    </>
  );
}
