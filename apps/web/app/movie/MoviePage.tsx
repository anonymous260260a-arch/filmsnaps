"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import MovieClient from "./MovieClient";
import { useMovieDetails } from "@/hooks/useMovieDetails";
import { SkeletonDetail } from "@/components/SkeletonLoader";
import { Header } from "@/components/Header";

function MovieDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  if (!id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">Movie not found</div>
      </div>
    );
  }

  return <MovieDetailInner id={id} />;
}

function MovieDetailInner({ id }: { id: string }) {
  const { data: movie } = useMovieDetails(id);

  if (!movie?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">Movie not found</div>
      </div>
    );
  }

  return (
    <>
      <Header />
      <MovieClient movie={movie} />
    </>
  );
}

export default function MoviePage() {
  return (
    <Suspense fallback={<SkeletonDetail />}>
      <MovieDetailContent />
    </Suspense>
  );
}
