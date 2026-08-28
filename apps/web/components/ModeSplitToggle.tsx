/**
 * ModeSplitToggle — segmented Movies/Anime control for the Hard Mode Split.
 *
 * Mirrors mobile's header toggle (apps/mobile/app/(tabs)/index.tsx:517-541).
 * Reads/writes the global app mode via useAppMode so the toggle stays in sync
 * across Header (web) and GlobalTopBar (desktop).
 */

"use client";

import { useAppMode, type AppMode } from "@/lib/useAppMode";

const OPTIONS: Array<{ value: AppMode; label: string }> = [
  { value: "movie_tv", label: "Movies" },
  { value: "anime", label: "Anime" },
];

export function ModeSplitToggle({ className = "" }: { className?: string }) {
  const { mode, setMode } = useAppMode();

  return (
    <div
      className={`flex flex-row items-center rounded-full border border-white/[0.06] bg-white/[0.03] p-0.5 ${className}`}
      role="group"
      aria-label="Content mode"
    >
      {OPTIONS.map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            aria-pressed={active}
            className={`h-7 rounded-full px-3 text-[11px] font-bold uppercase tracking-wide transition-all ${
              active
                ? "bg-primary text-black"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
