"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { Dashboard } from "./types";
import { QUALITY_ORDER, QUALITY_COLORS, GOLD, label } from "./constants";
import { fmtInt, fmtMs, fmtPct, sortedEntries, sum } from "./utils";
import { Section, Card, NoData } from "./shared";

interface PlaybackQualityProps {
  cur: Dashboard | null;
  prev: Dashboard | null;
  openDrill: (event: string, title: string) => void;
}

export function PlaybackQuality({
  cur,
  prev,
  openDrill,
}: PlaybackQualityProps) {
  const p5 = cur?.p5;
  const funnel = cur?.funnel;

  // ── 1. Quality Mix Data ──
  const qualityDist = p5?.qualityDist ?? {};
  const totalQualityWatches = Object.values(qualityDist).reduce(
    (a, b) => a + b,
    0,
  );

  const qualityData = useMemo(() => {
    if (totalQualityWatches === 0) return [];
    const ordered = QUALITY_ORDER.filter((k) => qualityDist[k] !== undefined);
    const extra = Object.keys(qualityDist).filter(
      (k) => !QUALITY_ORDER.includes(k),
    );
    return [...ordered, ...extra]
      .map((k) => ({
        key: k,
        name: label(k),
        value: qualityDist[k] ?? 0,
        color: QUALITY_COLORS[k] ?? GOLD,
      }))
      .filter((d) => d.value > 0);
  }, [qualityDist, totalQualityWatches]);

  // ── 2. Seek Latency ──
  const seekRows = p5?.seekLatency ?? [];
  const seekData = useMemo(() => {
    return seekRows
      .map((s) => ({
        kind: s.kind,
        name: label(s.kind),
        avgMs: s.avgMs,
        maxMs: s.maxMs,
        n: s.n,
      }))
      .sort((a, b) => b.avgMs - a.avgMs);
  }, [seekRows]);

  // ── 3. Buffering Stats ──
  const stallEvents = p5?.rebuffer?.stallEvents ?? funnel?.bufferStalls ?? 0;
  const stallMs = p5?.rebuffer?.stallMs ?? 0;
  const rebufCount = p5?.rebuffer?.total ?? 0;
  const watchEnds = sum(p5?.completionCurve);
  const stallsPerWatch =
    watchEnds > 0 ? (rebufCount / watchEnds).toFixed(2) : "—";

  // ── 4. Switching & Resume ──
  const rcTrue = p5?.resumeCorrection?.["true"] ?? 0;
  const rcFalse = p5?.resumeCorrection?.["false"] ?? 0;
  const rcTotal = rcTrue + rcFalse;
  const resumeRate = rcTotal > 0 ? (rcTrue / rcTotal) * 100 : null;

  const exits = sum(p5?.exitDuringSwitch);
  const exitEntries = sortedEntries(p5?.exitDuringSwitch);

  const providerSwitches = sum(funnel?.providerSwitches);
  const switchEntries = sortedEntries(funnel?.providerSwitches);

  if (!cur) return null;

  return (
    <Section
      icon="🎬"
      title="Playback Quality"
      question="Is playback smooth, sharp, and fast to start — and does seeking feel instant?"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Quality Mix */}
        <Card
          title="Quality Mix"
          hint="Resolved resolution of watched sessions"
        >
          {totalQualityWatches === 0 ? (
            <NoData />
          ) : (
            <div className="h-60 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={qualityData}
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {qualityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                          <p className="font-bold text-white">{d.name}</p>
                          <p style={{ color: d.color }}>
                            {fmtInt(d.value)} sessions (
                            {fmtPct(d.value, totalQualityWatches)})
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="middle"
                    align="right"
                    layout="vertical"
                    formatter={(val) => (
                      <span className="text-xs text-white/70">{val}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Card 2: Seek Latency */}
        <Card
          title="Seek Latency"
          hint="Request → first frame rendered · lower is better"
        >
          {seekData.length === 0 ? (
            <NoData />
          ) : (
            <div className="h-60 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={seekData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.04)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    stroke="rgba(255,255,255,0.3)"
                    fontSize={10}
                    tickFormatter={(val) => fmtMs(val)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="rgba(255,255,255,0.7)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                          <p className="font-bold text-white">{d.name}</p>
                          <p className="text-sky-400">
                            Average: {fmtMs(d.avgMs)}
                          </p>
                          <p className="text-amber-400">
                            Worst: {fmtMs(d.maxMs)}
                          </p>
                          <p className="text-white/40 mt-1">
                            {fmtInt(d.n)} total seeks
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="avgMs"
                    fill="#38BDF8"
                    radius={[0, 4, 4, 0]}
                    onClick={() => openDrill("seek_latency", "Seek Latencies")}
                    style={{ cursor: "pointer" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Card 3: Buffering Stats */}
        <Card
          title="Buffering Stalls"
          hint="Playback interruptions after initial start"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-white/[0.02] border border-white/[0.05] rounded-xl flex flex-col justify-between">
              <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">
                Stall Events
              </span>
              <div className="text-2xl font-extrabold text-white mt-2 tabular-nums">
                {fmtInt(stallEvents)}
              </div>
              <span className="text-[11px] text-white/40 mt-1">
                {fmtInt(rebufCount)} episodes
              </span>
            </div>

            <div className="p-3.5 bg-white/[0.02] border border-white/[0.05] rounded-xl flex flex-col justify-between">
              <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">
                Total Stalled Time
              </span>
              <div className="text-2xl font-extrabold text-amber-400 mt-2 tabular-nums">
                {fmtMs(stallMs)}
              </div>
              <span className="text-[11px] text-white/40 mt-1">
                across all sessions
              </span>
            </div>

            <div className="p-3.5 bg-white/[0.02] border border-white/[0.05] rounded-xl flex flex-col justify-between">
              <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">
                Stalls Per Watch
              </span>
              <div className="text-2xl font-extrabold text-white mt-2 tabular-nums">
                {stallsPerWatch}
              </div>
              <span className="text-[11px] text-white/40 mt-1">
                target: &lt; 0.10
              </span>
            </div>
          </div>
        </Card>

        {/* Card 4: Switching & Resume */}
        <Card
          title="Switching & Resume Recovery"
          hint="How the player handles source transitions and state restore"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-white/[0.02] border border-white/[0.05] rounded-xl flex flex-col justify-between">
              <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">
                Resume Corrections
              </span>
              <div className="text-2xl font-extrabold text-white mt-2 tabular-nums">
                {resumeRate !== null ? `${resumeRate.toFixed(0)}%` : "—"}
              </div>
              <span className="text-[11px] text-white/40 mt-1">
                {fmtInt(rcTrue)} re-seeked
              </span>
            </div>

            <div className="p-3.5 bg-white/[0.02] border border-white/[0.05] rounded-xl flex flex-col justify-between">
              <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">
                Exits During Switch
              </span>
              <div
                className={`text-2xl font-extrabold mt-2 tabular-nums ${exits > 0 ? "text-red-400" : "text-white"}`}
              >
                {fmtInt(exits)}
              </div>
              <span className="text-[11px] text-white/40 mt-1">
                {exitEntries.length > 0
                  ? `${exitEntries[0][0]}: ${exitEntries[0][1]}`
                  : "no dropouts"}
              </span>
            </div>

            <div className="p-3.5 bg-white/[0.02] border border-white/[0.05] rounded-xl flex flex-col justify-between">
              <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">
                Provider Switches
              </span>
              <div className="text-2xl font-extrabold text-white mt-2 tabular-nums">
                {fmtInt(providerSwitches)}
              </div>
              <span className="text-[11px] text-white/40 mt-1">
                {switchEntries.length > 0
                  ? `${label(switchEntries[0][0])}: ${switchEntries[0][1]}`
                  : "none"}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}
