"use client";

import React from "react";
import type { Range } from "./types";
import { GOLD, PRESETS } from "./constants";
import { fmtDay } from "./utils";

interface DashboardHeaderProps {
  range: Range;
  setRange: (r: Range) => void;
  from: string;
  to: string;
  loading: boolean;
  onRefresh: () => void;
  updatedAt: Date | null;
}

export function DashboardHeader({
  range,
  setRange,
  from,
  to,
  loading,
  onRefresh,
  updatedAt,
}: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-[#0B0B0D]/90 backdrop-blur-md border-b border-white/[0.07]">
      <div className="flex flex-wrap items-center gap-5">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>FilmSnaps</span>
          <span
            className="text-xs uppercase px-2 py-0.5 rounded font-extrabold tracking-wider"
            style={{
              backgroundColor: `${GOLD}22`,
              color: GOLD,
              border: `1px solid ${GOLD}44`,
            }}
          >
            Telemetry
          </span>
        </h1>

        <div className="flex items-center gap-1.5 bg-[#141417] p-1 rounded-xl border border-white/[0.07]">
          {PRESETS.map((p) => {
            const active = range.kind === "preset" && range.days === p.days;
            return (
              <button
                key={p.label}
                onClick={() => setRange({ kind: "preset", days: p.days })}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  active
                    ? "bg-[#D4A237] text-[#0B0B0D] shadow-sm font-bold"
                    : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <input
            type="date"
            value={range.kind === "custom" ? range.from : from}
            onChange={(e) =>
              setRange({
                kind: "custom",
                from: e.target.value,
                to: range.kind === "custom" ? range.to : to,
              })
            }
            className="bg-[#141417] text-white/90 text-xs border border-white/[0.08] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#D4A237]/50"
            style={{ colorScheme: "dark" }}
          />
          <span className="text-white/30">–</span>
          <input
            type="date"
            value={range.kind === "custom" ? range.to : to}
            onChange={(e) =>
              setRange({
                kind: "custom",
                from: range.kind === "custom" ? range.from : from,
                to: e.target.value,
              })
            }
            className="bg-[#141417] text-white/90 text-xs border border-white/[0.08] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#D4A237]/50"
            style={{ colorScheme: "dark" }}
          />
        </div>

        <div className="text-xs text-white/40 font-mono hidden sm:inline-block">
          {fmtDay(from)} – {fmtDay(to)} · UTC
        </div>
      </div>

      <div className="flex items-center gap-4">
        {updatedAt && (
          <div className="text-xs text-white/30 font-mono hidden md:inline-block">
            Updated {updatedAt.toLocaleTimeString()}
          </div>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white bg-[#141417] border border-white/[0.08] hover:border-[#D4A237]/40 rounded-xl transition-all disabled:opacity-50"
          title="Refresh Dashboard"
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#D4A237]" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>{loading ? "Refreshing..." : "Refresh"}</span>
        </button>
      </div>
    </header>
  );
}
