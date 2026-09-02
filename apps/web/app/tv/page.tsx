"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TVClient from "./TVClient";
import TVShowPage from "./TVShowPage";
import { SkeletonGrid } from "@/components/SkeletonLoader";

function TVRouteInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  if (id) return <TVShowPage />;
  return <TVClient />;
}

export default function TVRoute() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#070708] px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <SkeletonGrid count={12} />
        </div>
      }
    >
      <TVRouteInner />
    </Suspense>
  );
}
