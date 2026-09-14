/**
 * LanguagePromptSheet — one-time first-run prompt (mobile parity) shown in
 * the video zone before the direct player mounts. Asks which audio language
 * the user prefers so source ranking matches their taste from day one
 * (Pass 3 of selectBestStream is a hard language bucket — this prompt is
 * what makes that dominance deliberate instead of arbitrary).
 *
 * "Auto" is the escape hatch (app decides: Multi > Hindi > English); the
 * choice stays editable anytime in Settings → Playback.
 */

"use client";

import React, { useState } from "react";
import { Languages, Check } from "lucide-react";
import type { PreferredLanguage } from "@/lib/streamSelector";

const OPTIONS: { value: PreferredLanguage; label: string; hint: string }[] = [
  {
    value: "auto",
    label: "Auto",
    hint: "App decides — Multi audio, then Hindi, then English",
  },
  {
    value: "multi",
    label: "Multi audio",
    hint: "Titles with multiple audio tracks preferred",
  },
  { value: "hindi", label: "Hindi", hint: "Prefer sources with Hindi audio" },
  {
    value: "english",
    label: "English",
    hint: "Prefer sources with English audio",
  },
];

interface LanguagePromptSheetProps {
  onSelect: (value: PreferredLanguage) => void;
}

export function LanguagePromptSheet({ onSelect }: LanguagePromptSheetProps) {
  const [selected, setSelected] = useState<PreferredLanguage | null>(null);

  const pick = (value: PreferredLanguage) => {
    if (selected) return; // double-click guard — answer is final
    setSelected(value);
    onSelect(value);
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#070708]/95 p-6">
      <div
        className="w-full max-w-[400px] bg-[#16161A] rounded-2xl border border-white/[0.08] shadow-2xl p-6 animate-[fadeIn_0.2s_ease-out]"
        role="alert"
      >
        <div className="w-12 h-12 rounded-full bg-[#D4A237]/10 border border-[#D4A237]/30 flex items-center justify-center mb-4">
          <Languages size={24} className="text-[#D4A237]" />
        </div>

        <h2 className="text-[17px] font-bold text-white leading-snug">
          What audio language do you prefer?
        </h2>
        <p className="text-xs text-white/45 leading-relaxed mt-1.5 mb-5">
          We&apos;ll rank sources to match. You can change this anytime in
          Settings.
        </p>

        <div className="flex flex-col gap-1.5">
          {OPTIONS.map((option) => {
            const isSelected = selected === option.value;
            return (
              <button
                key={option.value}
                onClick={() => pick(option.value)}
                className={`flex items-center justify-between gap-3 text-left rounded-xl border px-4 py-3 min-h-[54px] transition-colors ${
                  isSelected
                    ? "bg-[#D4A237]/10 border-[#D4A237]/50"
                    : "bg-white/[0.02] border-white/[0.07] hover:bg-white/[0.05] hover:border-white/[0.12]"
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span
                    className={`block text-sm font-semibold ${
                      isSelected ? "text-[#D4A237]" : "text-white"
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="block text-[11px] text-white/40 leading-4 mt-0.5">
                    {option.hint}
                  </span>
                </span>
                {isSelected ? (
                  <Check size={18} className="text-[#D4A237] shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
