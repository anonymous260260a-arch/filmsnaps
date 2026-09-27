"use client";

import React, { useEffect, useState } from "react";
import type { DrillState, RawRow } from "./types";
import { fmtDay } from "./utils";
import { label, GOLD } from "./constants";

interface DrillDrawerProps {
  state: NonNullable<DrillState>;
  onClose: () => void;
}

export function DrillDrawer({ state, onClose }: DrillDrawerProps) {
  const [data, setData] = useState<RawRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setData(null);

    const fromParam = state.from ? `&from=${state.from}` : "";
    const toParam = state.to ? `&to=${state.to}` : "";

    fetch(
      `/api/telemetry/dashboard?mode=raw&event=${encodeURIComponent(state.event)}${fromParam}${toParam}&limit=60`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (mounted) {
          setData(json.rows || json.data || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || "An error occurred");
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [state.event, state.from, state.to]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        className="relative w-full max-w-2xl bg-[#0E0E12] border-l border-white/10 h-full flex flex-col shadow-2xl z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between shrink-0 bg-[#121216]">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className="px-2 py-0.5 rounded text-xs font-mono font-bold"
                style={{
                  backgroundColor: `${GOLD}22`,
                  color: GOLD,
                  border: `1px solid ${GOLD}44`,
                }}
              >
                {state.event}
              </span>
              <h2 className="text-sm font-semibold text-white/90">
                {state.title || "Raw Telemetry Drilldown"}
              </h2>
            </div>
            <div className="text-xs text-white/40 mt-1 font-mono">
              {state.from ? fmtDay(state.from) : "All time"}{" "}
              {state.to ? `– ${fmtDay(state.to)}` : ""} · Max 60 events
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span>Close</span>
            <kbd className="text-[10px] text-white/40 bg-white/[0.06] px-1 py-0.5 rounded">
              Esc
            </kbd>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-auto p-6">
          {loading && (
            <div className="flex flex-col items-center justify-center h-48 text-white/40 gap-3">
              <svg
                className="w-5 h-5 animate-spin text-[#D4A237]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span className="text-xs">Loading raw event logs...</span>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
              <p className="font-semibold mb-1">Failed to load raw events</p>
              <p className="opacity-80">{error}</p>
            </div>
          )}

          {!loading && !error && data && data.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-white/40 text-xs">
              No recent events matching this filter.
            </div>
          )}

          {!loading && !error && data && data.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs text-white/40 font-mono mb-2">
                Showing {data.length} latest events (newest first)
              </div>
              <div className="divide-y divide-white/[0.06]">
                {data.map((row, i) => (
                  <div key={`${row.ts}-${i}`} className="py-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-white/80 tabular-nums">
                        {new Date(row.ts).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <div className="flex items-center gap-2">
                        {row.appVersion && (
                          <span className="text-[11px] font-mono text-white/50 bg-white/[0.04] px-1.5 py-0.5 rounded">
                            v{row.appVersion}
                          </span>
                        )}
                        {row.connectionClass && (
                          <span className="text-[11px] font-mono text-sky-400/80 bg-sky-400/10 px-1.5 py-0.5 rounded">
                            {label(row.connectionClass)}
                          </span>
                        )}
                        {row.deviceTier && (
                          <span className="text-[11px] font-mono text-white/40 bg-white/[0.04] px-1.5 py-0.5 rounded">
                            {row.deviceTier}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Dimensions Chips */}
                    {row.dims && Object.keys(row.dims).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {Object.entries(row.dims).map(([k, v]) => (
                          <span
                            key={k}
                            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] text-white/70"
                          >
                            <span className="text-white/40">{k}:</span>
                            <span className="text-white/90">{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-white/30 italic">
                        No custom dimensions
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
