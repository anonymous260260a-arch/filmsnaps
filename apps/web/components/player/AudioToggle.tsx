/**
 * AudioToggle — Dub/Sub segmented control for anime providers that expose both
 * audio tracks (MegaPlay). Reads/writes the player-context `audio` so the embed
 * URL (and its remount key) follow the selection. Hidden by the caller unless
 * the active provider is a MegaPlay-style anime provider.
 */

"use client";

import React from "react";

const OPTS: Array<{ value: "sub" | "dub"; label: string }> = [
  { value: "sub", label: "Sub" },
  { value: "dub", label: "Dub" },
];

export function AudioToggle({
  audio,
  onAudioChange,
  className = "",
}: {
  audio: "sub" | "dub";
  onAudioChange: (next: "sub" | "dub") => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Audio track"
      className={`inline-flex items-center rounded-full border border-white/[0.08] bg-[#0E0E11] p-0.5 ${className}`}
    >
      {OPTS.map((opt) => {
        const active = audio === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onAudioChange(opt.value)}
            className={`h-7 rounded-full px-3 text-[11px] font-bold uppercase tracking-wide transition-colors ${
              active
                ? "bg-[#D4A237] text-[#070708]"
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
