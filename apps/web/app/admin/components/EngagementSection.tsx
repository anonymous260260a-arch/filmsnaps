"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
  Cell,
} from "recharts";
import { Section, Card, NoData } from "./shared";
import type { Dashboard } from "./types";
import {
  COMPLETION_ORDER,
  COMPLETION_COLORS,
  DURATION_ORDER,
  DURATION_COLORS,
  GOLD,
  label,
} from "./constants";
import { fmtDay, fmtInt, fmtPct } from "./utils";

interface EngagementSectionProps {
  cur: Dashboard | null;
  openDrill: (event: string, title: string) => void;
}

export function EngagementSection({ cur, openDrill }: EngagementSectionProps) {
  const p5 = cur?.p5;
  const sessions = cur?.sessions;

  // ── 1. Completion Curve ──
  const completionCurve = p5?.completionCurve ?? {};
  const totalCompletion = Object.values(completionCurve).reduce(
    (a, b) => a + b,
    0,
  );
  const completionSegments = useMemo(() => {
    if (totalCompletion === 0) return [];
    return COMPLETION_ORDER.map((k) => {
      const count = completionCurve[k] ?? 0;
      return {
        key: k,
        label: label(k),
        count,
        pct: totalCompletion > 0 ? (count / totalCompletion) * 100 : 0,
        color: COMPLETION_COLORS[k] ?? GOLD,
      };
    });
  }, [completionCurve, totalCompletion]);

  // ── 2. Session Lengths ──
  const durationBuckets = sessions?.durationBuckets ?? {};
  const totalDurations = Object.values(durationBuckets).reduce(
    (a, b) => a + b,
    0,
  );
  const durationSegments = useMemo(() => {
    if (totalDurations === 0) return [];
    return DURATION_ORDER.map((k) => {
      const count = durationBuckets[k] ?? 0;
      return {
        key: k,
        label: k,
        count,
        pct: totalDurations > 0 ? (count / totalDurations) * 100 : 0,
        color: DURATION_COLORS[k] ?? "#5B9CF6",
      };
    });
  }, [durationBuckets, totalDurations]);

  // ── 3. Watch Hours ──
  const hourData = useMemo(() => {
    const raw = p5?.watchHourHistogram ?? [];
    const byHour = new Map(raw.map((d) => [d.hour, d.n]));
    const maxVal = Math.max(1, ...Array.from(byHour.values()));
    return Array.from({ length: 24 }, (_, h) => {
      const count = byHour.get(h) ?? 0;
      return {
        hour: h,
        hourLabel: `${String(h).padStart(2, "0")}:00`,
        count,
        isPeak: count === maxVal && count > 0,
      };
    });
  }, [p5?.watchHourHistogram]);

  // ── 4. Sessions Per Day ──
  const sessionDays = useMemo(() => {
    const perDay = sessions?.perDay ?? [];
    return perDay.map((d) => ({
      day: d.day,
      displayDay: fmtDay(d.day),
      count: d.n,
    }));
  }, [sessions?.perDay]);

  if (!cur) return null;

  return (
    <Section
      icon="📊"
      title="Engagement"
      question="How much of the content do people actually watch, and when do they show up?"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Completion Curve */}
        <Card title="Completion Curve" hint="% of media watched per session">
          {totalCompletion === 0 ? (
            <NoData />
          ) : (
            <div className="space-y-4">
              {/* Stacked bar visualization */}
              <div
                className="flex h-7 rounded-xl overflow-hidden cursor-pointer border border-white/[0.05]"
                onClick={() =>
                  openDrill("watch_end", "Watch Completion Sessions")
                }
              >
                {completionSegments.map((s) => (
                  <div
                    key={s.key}
                    style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                    title={`${s.label}: ${fmtInt(s.count)} (${s.pct.toFixed(1)}%)`}
                    className="h-full transition-all hover:opacity-85"
                  />
                ))}
              </div>

              {/* Legend breakdown */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {completionSegments.map((s) => (
                  <div
                    key={s.key}
                    onClick={() =>
                      openDrill("watch_end", `Completion: ${s.label}`)
                    }
                    className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-[11px] text-white/50">
                        {s.label}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-white tabular-nums">
                      {fmtPct(s.count, totalCompletion)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Card 2: Session Length */}
        <Card
          title="Session Length"
          hint="Wall-clock time per foreground session"
        >
          {totalDurations === 0 ? (
            <NoData />
          ) : (
            <div className="space-y-4">
              <div
                className="flex h-7 rounded-xl overflow-hidden cursor-pointer border border-white/[0.05]"
                onClick={() =>
                  openDrill("session_end", "Session Duration Distribution")
                }
              >
                {durationSegments.map((s) => (
                  <div
                    key={s.key}
                    style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                    title={`${s.label}: ${fmtInt(s.count)} (${s.pct.toFixed(1)}%)`}
                    className="h-full transition-all hover:opacity-85"
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {durationSegments.map((s) => (
                  <div
                    key={s.key}
                    onClick={() =>
                      openDrill("session_end", `Session Duration: ${s.label}`)
                    }
                    className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-[11px] text-white/50">
                        {s.label}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-white tabular-nums">
                      {fmtPct(s.count, totalDurations)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Card 3: Watch Opens by Hour */}
        <Card
          title="Watch Opens by Hour (UTC)"
          hint="Time of day peak traffic — optimal for scheduling releases"
        >
          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={hourData}
                margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.04)"
                  vertical={false}
                />
                <XAxis
                  dataKey="hour"
                  stroke="rgba(255,255,255,0.3)"
                  fontSize={10}
                  tickLine={false}
                  tickFormatter={(val) => `${val}h`}
                  interval={3}
                />
                <YAxis
                  stroke="rgba(255,255,255,0.3)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const item = payload[0].payload;
                    return (
                      <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                        <div className="font-bold text-white">
                          {item.hourLabel} UTC
                        </div>
                        <div className="text-[#D4A237] mt-0.5">
                          {fmtInt(item.count)} watch opens
                        </div>
                        {item.isPeak && (
                          <div className="text-emerald-400 text-[10px] mt-1 font-semibold">
                            ★ Peak Hour
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {hourData.map((entry, index) => (
                    <Cell
                      key={`hour-cell-${index}`}
                      fill={
                        entry.isPeak
                          ? "#34D399"
                          : entry.count > 0
                            ? GOLD
                            : "rgba(255,255,255,0.08)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Card 4: Sessions Per Day */}
        <Card
          title="Sessions Per Day"
          hint="Daily foreground app sessions trend"
        >
          {sessionDays.length === 0 ? (
            <NoData />
          ) : (
            <div className="h-56 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={sessionDays}
                  margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="sessionGoldGrad"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={GOLD} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={GOLD} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.04)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="displayDay"
                    stroke="rgba(255,255,255,0.3)"
                    fontSize={10}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.3)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0].payload;
                      return (
                        <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                          <div className="font-bold text-white">
                            {item.displayDay}
                          </div>
                          <div className="text-[#D4A237] mt-0.5">
                            {fmtInt(item.count)} sessions
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke={GOLD}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#sessionGoldGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </Section>
  );
}
