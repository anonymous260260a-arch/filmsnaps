"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PersonClient from "./PersonClient";
import { usePersonDetails, usePersonCredits } from "@/hooks/usePersonDetails";

function PersonDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  if (!id) {
    return (
      <div className="min-h-screen bg-[#070708] flex items-center justify-center flex-col gap-4 px-6">
        <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center">
          <span className="text-faint text-2xl font-bold">?</span>
        </div>
        <p className="text-foreground text-lg font-semibold">
          Person not found
        </p>
        <a
          href="/"
          className="bg-[#D4A237] rounded-xl py-3 px-8 text-[#070708] font-bold text-sm"
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
      <div className="min-h-screen bg-[#070708] flex items-center justify-center flex-col gap-4 px-6">
        <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center">
          <span className="text-faint text-2xl font-bold">?</span>
        </div>
        <p className="text-foreground text-lg font-semibold">
          Person not found
        </p>
        <a
          href="/"
          className="bg-[#D4A237] rounded-xl py-3 px-8 text-[#070708] font-bold text-sm"
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
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#070708] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#D4A237] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <PersonDetailContent />
    </Suspense>
  );
}
