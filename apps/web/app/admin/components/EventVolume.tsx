"use client";

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
import { GOLD } from "./constants";
import { fmtInt } from "./utils";
import { Section, Card, NoData } from "./shared";

interface EventVolumeProps {
  cur: Dashboard | null;
  openDrill: (event: string, title: string) => void;
}

export function EventVolume({ cur, openDrill }: EventVolumeProps) {
  const totals = cur?.totals ?? {};
  const data = useMemo(() => {
    const entries = Object.entries(totals);
    if (entries.length === 0) return [];
    return entries
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
  }, [totals]);

  if (!cur) return null;

  return (
    <Section
      icon="📈"
      title="Event Volume"
      question="Everything reported in this range — sanity-check that ingest is alive."
    >
      <Card
        title="Event Totals"
        hint="Click any bar to inspect raw event telemetry"
      >
        {data.length === 0 ? (
          <NoData message="No telemetry events recorded in range" />
        ) : (
          <div className="h-96 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 50, bottom: 5 }}
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
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={140}
                  stroke="rgba(255,255,255,0.7)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={({ active, payload, label: itemLabel }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                        <p className="font-bold text-white font-mono">
                          {itemLabel}
                        </p>
                        <p
                          style={{ color: GOLD }}
                          className="mt-0.5 font-semibold"
                        >
                          {fmtInt(payload[0].value as number)} events
                        </p>
                        <p className="text-white/40 text-[10px] mt-1">
                          Click to drill down
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="value"
                  fill={GOLD}
                  radius={[0, 4, 4, 0]}
                  onClick={(entry: any) => {
                    const eventName = entry?.name || entry?.payload?.name;
                    if (eventName) openDrill(eventName, `Event: ${eventName}`);
                  }}
                  style={{ cursor: "pointer" }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </Section>
  );
}
