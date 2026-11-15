"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PersonClient from "./PersonClient";
import { usePersonDetails, usePersonCredits } from "@/hooks/usePersonDetails";
import { SkeletonPerson } from "@/components/SkeletonLoader";

function PersonDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  if (!id) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center flex-col gap-4 px-6">
        <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center">
          <span className="text-faint text-2xl font-bold">?</span>
        </div>
        <p className="text-foreground text-lg font-semibold">
          Person not found
        </p>
        <a
          href="/"
          className="bg-primary rounded-xl py-3 px-8 text-background font-bold text-sm"
        >
          Go Home
        </a>
      </div>
    );
  }

  return <PersonDetailInner id={id} />;
}

function PersonDetailInner({ id }: { id: string }) {
  const { data: person } = usePersonDetails(id);
  const { data: creditsData } = usePersonCredits(id);
  const credits = creditsData?.cast ?? [];

  if (!person?.id) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center flex-col gap-4 px-6">
        <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center">
          <span className="text-faint text-2xl font-bold">?</span>
        </div>
        <p className="text-foreground text-lg font-semibold">
          Person not found
        </p>
        <a
          href="/"
          className="bg-primary rounded-xl py-3 px-8 text-background font-bold text-sm"
        >
          Go Home
        </a>
      </div>
    );
  }

  return <PersonClient person={person} credits={credits} />;
}

export default function PersonPage() {
  return (
    <Suspense fallback={<SkeletonPerson />}>
      <PersonDetailContent />
    </Suspense>
  );
}
