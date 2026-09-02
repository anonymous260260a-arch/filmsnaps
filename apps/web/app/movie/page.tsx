"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import MoviesClient from "./MoviesClient";
import MoviePage from "./MoviePage";
import { SkeletonGrid } from "@/components/SkeletonLoader";

function MovieRouteInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  if (id) return <MoviePage />;
  return <MoviesClient />;
}

export default function MovieRoute() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#070708] px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <SkeletonGrid count={12} />
        </div>
      }
    >
      <MovieRouteInner />
    </Suspense>
  );
}
