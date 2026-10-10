"use client";

import React from "react";
import { GOLD } from "./constants";

interface FilterBarProps {
  appVersion: string | null;
  anonId: string | null;
  event: string | null;
  fromDay: string;
  toDay: string;
  onFilterChange: (filters: {
    appVersion?: string;
    anonId?: string;
    event?: string;
    clear?: boolean;
  }) => void;
}

const KNOWN_VERSIONS = ["2.1.1", "2.3.0", "2.4.0", "2.4.1"];

export function FilterBar({
  appVersion,
  anonId,
  event,
  fromDay,
  toDay,
  onFilterChange,
}: FilterBarProps) {
  const activeFilterCount =
    (appVersion ? 1 : 0) + (anonId ? 1 : 0) + (event ? 1 : 0);

  return (
    <div className="sticky top-14 z-30 bg-[#0B0B0D]/95 backdrop-blur-md border-b border-white/[0.07] px-6 py-3">
      <div className="max-w-[1360px] mx-auto flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">
            App Version
          </label>
          <select
            value={appVersion ?? ""}
            onChange={(e) =>
              onFilterChange({
                appVersion: e.target.value || undefined,
              })
            }
            className="bg-[#141417] text-white/90 text-xs border border-white/[0.08] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#D4A237]/50 min-w-[80px]"
            style={{ colorScheme: "dark" }}
          >
            <option value="">All versions</option>
            {KNOWN_VERSIONS.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">
            Anon ID
          </label>
          <input
            type="text"
            placeholder="Full UUID (trace one user)"
            value={anonId ?? ""}
            onChange={(e) =>
              onFilterChange({
                anonId: e.target.value || undefined,
              })
            }
            className="bg-[#141417] text-white/90 text-xs border border-white/[0.08] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#D4A237]/50 font-mono w-[200px]"
            style={{ colorScheme: "dark" }}
          />
        </div>

        {activeFilterCount > 0 && (
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <span className="text-[11px] text-white/40">Active filters:</span>
            {appVersion && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono bg-[#D4A237]/10 text-[#D4A237] border border-[#D4A237]/20 px-2 py-0.5 rounded-full">
                v{appVersion}
                <button
                  onClick={() => onFilterChange({ appVersion: undefined })}
                  className="hover:text-white transition-colors"
                  title="Remove filter"
                >
                  ×
                </button>
              </span>
            )}
            {anonId && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono bg-violet-400/10 text-violet-300 border border-violet-400/20 px-2 py-0.5 rounded-full">
                {anonId.slice(0, 8)}...
                <button
                  onClick={() => onFilterChange({ anonId: undefined })}
                  className="hover:text-white transition-colors"
                  title="Remove filter"
                >
                  ×
                </button>
              </span>
            )}
            {event && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono bg-sky-400/10 text-sky-300 border border-sky-400/20 px-2 py-0.5 rounded-full">
                {event}
                <button
                  onClick={() => onFilterChange({ event: undefined })}
                  className="hover:text-white transition-colors"
                  title="Remove filter"
                >
                  ×
                </button>
              </span>
            )}
            <button
              onClick={() => onFilterChange({ clear: true })}
              className="text-[11px] text-white/40 hover:text-white ml-1 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}

        <div className="ml-auto text-[11px] text-white/30 font-mono hidden sm:block">
          {fromDay} to {toDay} UTC
        </div>
      </div>
    </div>
  );
}
