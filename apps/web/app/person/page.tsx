"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PersonPage from "./PersonPage";
import { SkeletonDetail } from "@/components/SkeletonLoader";

function PersonRouteInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  if (id) return <PersonPage />;
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-lg text-muted-foreground">Person not found</div>
    </div>
  );
}

export default function PersonRoute() {
  return (
    <Suspense fallback={<SkeletonDetail />}>
      <PersonRouteInner />
    </Suspense>
  );
}
