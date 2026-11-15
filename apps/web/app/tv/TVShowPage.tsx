"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TVDetailClient from "./TVDetailClient";
import { useTVDetails } from "@/hooks/useTVDetails";
import { SkeletonDetail } from "@/components/SkeletonLoader";
import { Header } from "@/components/Header";

function TVDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  if (!id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">TV show not found</div>
      </div>
    );
  }

  return <TVDetailInner id={id} />;
}

function TVDetailInner({ id }: { id: string }) {
  const { data: show } = useTVDetails(id);

  if (!show?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">TV show not found</div>
      </div>
    );
  }

  return (
    <>
      <Header />
      <TVDetailClient show={show} />
    </>
  );
}

export default function TVShowPage() {
  return (
    <Suspense fallback={<SkeletonDetail />}>
      <TVDetailContent />
    </Suspense>
  );
}
