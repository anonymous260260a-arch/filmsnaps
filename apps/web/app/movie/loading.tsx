"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SkeletonDetail, SkeletonGrid } from "@/components/SkeletonLoader";

function LoadingState() {
  const searchParams = useSearchParams();

  // The route serves two states — the browse grid (no ?id=) and the detail
  // page (?id=) — so the skeleton mirrors whichever is about to render
  // instead of flashing a grid before a detail layout.
  if (searchParams.get("id")) return <SkeletonDetail />;

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-8 pt-24 pb-12">
      <SkeletonGrid count={12} />
    </div>
  );
}

export default function Loading() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <SkeletonGrid count={12} />
        </div>
      }
    >
      <LoadingState />
    </Suspense>
  );
}
