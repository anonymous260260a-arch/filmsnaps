"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { Dashboard } from "./types";
import { label } from "./constants";
import { fmtInt } from "./utils";
import { Section, Card, NoData } from "./shared";

interface ReliabilitySectionProps {
  cur: Dashboard | null;
  openDrill: (event: string, title: string) => void;
}

export function ReliabilitySection({
  cur,
  openDrill,
}: ReliabilitySectionProps) {
  const errorData = useMemo(() => {
    const raw = cur?.funnel?.playerErrors ?? [];
    if (raw.length === 0) return [];

    // Group by errorClass (and surface if present)
    const grouped = raw.reduce(
      (acc, err) => {
        const key = err.surface
          ? `${err.errorClass} (${err.surface})`
          : err.errorClass;
        acc[key] = (acc[key] || 0) + err.n;
        return acc;
      },
      {} as Record<string, number>,
    );

    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [cur?.funnel?.playerErrors]);

  const exitData = useMemo(() => {
    const raw = cur?.sessions?.closeFromScreen ?? {};
    const entries = Object.entries(raw);
    if (entries.length === 0) return [];

    return entries
      .map(([name, value]) => ({ name: label(name), rawKey: name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [cur?.sessions?.closeFromScreen]);

  if (!cur) return null;

  return (
    <Section
      icon="🛡️"
      title="Reliability"
      question="What exactly is breaking, on which surface, and how often?"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Player Errors by Class */}
        <Card
          title="Player Errors by Class"
          hint="Grouped by error classification & rendering surface"
        >
          {errorData.length === 0 ? (
            <NoData message="No player errors reported in range" />
          ) : (
            <div className="h-64 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={errorData}
                  layout="vertical"
                  margin={{ left: 40, right: 30, top: 5, bottom: 5 }}
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
                    type="category"
                    dataKey="name"
                    stroke="rgba(255,255,255,0.7)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={110}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    content={({ active, payload, label: itemLabel }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                          <p className="font-bold text-white">{itemLabel}</p>
                          <p className="text-red-400 mt-0.5">
                            {fmtInt(payload[0].value as number)} occurrences
                          </p>
                          <p className="text-white/40 text-[10px] mt-1">
                            Click to drill down into raw events
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="value"
                    fill="#F87171"
                    radius={[0, 4, 4, 0]}
                    onClick={(d: any) =>
                      openDrill("player_error", `Error: ${d.name}`)
                    }
                    style={{ cursor: "pointer" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Card 2: Where Sessions End */}
        <Card
          title="Where Sessions End"
          hint="The last screen viewed before closing or backgrounding"
        >
          {exitData.length === 0 ? (
            <NoData message="No session termination data in range" />
          ) : (
            <div className="h-64 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={exitData}
                  layout="vertical"
                  margin={{ left: 30, right: 30, top: 5, bottom: 5 }}
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
                    type="category"
                    dataKey="name"
                    stroke="rgba(255,255,255,0.7)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={90}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    content={({ active, payload, label: itemLabel }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                          <p className="font-bold text-white">{itemLabel}</p>
                          <p className="text-purple-400 mt-0.5">
                            {fmtInt(payload[0].value as number)} session exits
                          </p>
                          <p className="text-white/40 text-[10px] mt-1">
                            Click to drill down into raw events
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="value"
                    fill="#A78BFA"
                    radius={[0, 4, 4, 0]}
                    onClick={(d: any) =>
                      openDrill("session_end", `Exit from: ${d.name}`)
                    }
                    style={{ cursor: "pointer" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </Section>
  );
}
