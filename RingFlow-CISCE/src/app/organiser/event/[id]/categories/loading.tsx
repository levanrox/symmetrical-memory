import React from "react";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { CategoryListSkeleton } from "@/components/ui/Skeleton";

export default function OrganiserCategoriesLoading() {
  return (
    <>
      <OrganiserHeader title="Categories" />
      
      <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 sm:space-y-8 bg-surface pb-24 w-full">
        {/* Header Block */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="font-headline-sm text-headline-sm text-primary">Division Management</h2>
            <p className="text-body-sm text-on-surface-variant">View categories and matches for this tournament.</p>
          </div>
        </div>

        {/* Responsive Categories Skeletons (Cards on Mobile, Table on Desktop) */}
        <CategoryListSkeleton count={6} readOnly={true} />
      </div>
    </>
  );
}
