"use client";

/**
 * M1 — Ad Slot Impressions (separate dashboard section).
 *
 * Answers one question: if we placed ads at these candidate slots, how many
 * views/day would each get? The app ships NO ads yet — this is instrumentation
 * for the monetization decision. Revenue columns are projections only
 * (90% fill, India-typical eCPM range), never actual earnings.
 */

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Dashboard } from "./types";
import { label as formatLabel } from "./constants";
import { fmtInt } from "./utils";
import { Section, Card, NoData } from "./shared";

interface AdSlotImpressionsProps {
  cur: Dashboard | null;
  openDrill: (event: string, title: string) => void;
  rangeDays: number;
}

/** Projected monthly revenue at a given eCPM (90% fill, 30-day month). */
function estMonthly(avgPerDay: number, ecpm: number): number {
  return (avgPerDay * 30 * 0.9 * ecpm) / 1000;
}

const SLOT_COLORS = [
  "#D4A237",
  "#5B9CF6",
  "#34D399",
  "#A78BFA",
  "#F472B6",
  "#38BDF8",
];

export function AdSlotImpressions({
  cur,
  openDrill,
  rangeDays,
}: AdSlotImpressionsProps) {
  const slots = cur?.impressions?.slots ?? [];
  const byDay = cur?.impressions?.byDay ?? [];

  // One row per day, one column per slot (stacked chart).
  const trend = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    for (const r of byDay) {
      const row = map.get(r.day) ?? { day: r.day };
      row[r.slot] = r.n;
      map.set(r.day, row);
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.day).localeCompare(String(b.day)),
    );
  }, [byDay]);

  const slotNames = useMemo(
    () => Array.from(new Set(byDay.map((r) => r.slot))),
    [byDay],
  );

  if (!cur) return null;

  return (
    <Section
      icon="💰"
      title="Ad Slot Impressions"
      question="If ads were placed at these candidate slots, how many views/day would each get? Measurement only — no ads run in the app yet. Use this table to pick slots."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Candidate Slots" hint="click a row to inspect raw events">
          {slots.length === 0 ? (
            <NoData message="No ad_slot_view events in range — the instrumented app build may not be out yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/40 text-left border-b border-white/[0.07]">
                    <th className="py-1.5 pr-2 font-semibold">Slot</th>
                    <th className="py-1.5 px-2 font-semibold text-right">
                      Views
                    </th>
                    <th className="py-1.5 px-2 font-semibold text-right">
                      Users
                    </th>
                    <th className="py-1.5 px-2 font-semibold text-right">
                      Views/day
                    </th>
                    <th className="py-1.5 px-2 font-semibold text-right">
                      vs screen
                    </th>
                    <th className="py-1.5 pl-2 font-semibold text-right">
                      $/mo @ $0.5–1.5 eCPM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr
                      key={`${s.slot}|${s.screen}`}
                      className="border-t border-white/[0.05] hover:bg-white/[0.03] cursor-pointer"
                      onClick={() =>
                        openDrill("ad_slot_view", `Slot: ${s.slot}`)
                      }
                    >
                      <td className="py-2 pr-2 font-semibold text-white/85">
                        {formatLabel(s.slot)}
                        <span className="text-white/30 font-normal">
                          {" "}
                          · {formatLabel(s.screen)}
                        </span>
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {fmtInt(s.views)}
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {fmtInt(s.users)}
                      </td>
                      <td className="px-2 text-right tabular-nums font-semibold">
                        {s.avgPerDay}
                      </td>
                      <td className="px-2 text-right text-white/50 tabular-nums">
                        {s.fillRate == null ? "—" : `${s.fillRate}%`}
                      </td>
                      <td className="pl-2 text-right text-emerald-400/90 tabular-nums font-semibold">
                        ${estMonthly(s.avgPerDay, 0.5).toFixed(0)}–$
                        {estMonthly(s.avgPerDay, 1.5).toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Views per Day by Slot"
          hint="stacked daily impression opportunities"
        >
          {trend.length === 0 ? (
            <NoData message="No daily ad-slot data in range" />
          ) : (
            <div className="h-72 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={trend}
                  margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.04)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    stroke="rgba(255,255,255,0.3)"
                    fontSize={10}
                    tickFormatter={(d) => String(d).slice(5)}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.3)"
                    fontSize={10}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    contentStyle={{
                      background: "#121216",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 12,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.9)",
                    }}
                    formatter={(v: number, name: string) => [
                      `${fmtInt(v)} views`,
                      formatLabel(name),
                    ]}
                  />
                  {slotNames.map((s, i) => (
                    <Bar
                      key={s}
                      dataKey={s}
                      stackId="slots"
                      fill={SLOT_COLORS[i % SLOT_COLORS.length]}
                      radius={
                        i === slotNames.length - 1 ? [3, 3, 0, 0] : undefined
                      }
                      onClick={() => openDrill("ad_slot_view", `Slot: ${s}`)}
                      style={{ cursor: "pointer" }}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <p className="mt-3 text-[11px] text-white/35 italic leading-relaxed">
        {cur.impressions?.note ??
          "Impression measurement only — no ads run in the app."}{" "}
        Range: {rangeDays} day{rangeDays === 1 ? "" : "s"}.
        {slots.length > 0 && (
          <>
            {" "}
            Total: {fmtInt(cur.impressions?.totalViews ?? 0)} views from{" "}
            {fmtInt(cur.impressions?.totalUsers ?? 0)} installs.
          </>
        )}
      </p>
    </Section>
  );
}
