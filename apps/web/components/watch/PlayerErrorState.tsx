/**
 * PlayerErrorState — error overlay displayed ON the video (not below).
 *
 * Shows provider name, retry options, and quick-switch to alternative servers.
 * Servers are offered in registry order — no ping rearrangement, no auto/best-available.
 */

"use client";

import React from "react";
import { Clapperboard, RefreshCw } from "lucide-react";
import type { ProviderDefinition } from "@filmsnaps/shared";

interface PlayerErrorStateProps {
  /** Name of the current provider that failed */
  currentProviderName: string;
  /** All available providers (for "Try next" suggestions) */
  providers: ProviderDefinition[];
  /** Currently selected provider id */
  selectedId: string | null;
  /** Called when a specific provider should be selected */
  onSelectProvider: (provider: ProviderDefinition) => void;
  /** Called to retry the current provider */
  onRetry: () => void;
}

export function PlayerErrorState({
  currentProviderName,
  providers,
  selectedId,
  onSelectProvider,
  onRetry,
}: PlayerErrorStateProps) {
  // Find alternative providers (not the current one)
  const alternatives = providers.filter(
    (p) => p.id !== selectedId && p.id !== "falix",
  );

  // Pick a couple of good alternatives for quick-switch buttons
  const quickSwitches = alternatives.slice(0, 3);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708]/90 backdrop-blur-sm z-40 gap-4 px-6">
      <Clapperboard className="text-[#D4A237]" size={48} strokeWidth={1.5} />

      <p
        className="text-xl text-[#F4F4F5] font-bold text-center"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Playback interrupted
      </p>

      <p className="text-sm text-[#A1A1AA] text-center max-w-sm">
        Stream failed on{" "}
        <strong className="text-[#F4F4F5]">{currentProviderName}</strong>.
      </p>

      {/* Quick-switch buttons */}
      <div className="flex items-center gap-2 flex-wrap justify-center mt-2">
        {quickSwitches.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectProvider(p)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full
              bg-[#D4A237]/10 border border-[#D4A237]/30 text-[#D4A237]
              text-xs font-bold hover:bg-[#D4A237]/20 transition-all active:scale-95"
          >
            Try {p.displayName || p.name}
          </button>
        ))}

        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full
            bg-[#D4A237] text-[#070708] text-xs font-bold
            hover:bg-[#B88B2A] transition-all active:scale-95"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    </div>
  );
}
