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
import { label as formatLabel } from "./constants";
import { fmtInt } from "./utils";
import { Section, Card, NoData } from "./shared";

interface AdoptionSectionProps {
  cur: Dashboard | null;
  openDrill: (event: string, title: string) => void;
}

export function AdoptionSection({ cur, openDrill }: AdoptionSectionProps) {
  const featureData = useMemo(() => {
    const raw = cur?.features ?? [];
    if (raw.length === 0) return [];

    const grouped = raw.reduce(
      (acc, f) => {
        if (!acc[f.feature]) {
          acc[f.feature] = { total: 0, contexts: {} };
        }
        acc[f.feature].total += f.n;
        acc[f.feature].contexts[f.context] =
          (acc[f.feature].contexts[f.context] || 0) + f.n;
        return acc;
      },
      {} as Record<string, { total: number; contexts: Record<string, number> }>,
    );

    return Object.entries(grouped)
      .map(([name, data]) => {
        const topContext =
          Object.entries(data.contexts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "";
        return {
          name,
          value: data.total,
          topContext,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [cur?.features]);

  const screenData = useMemo(() => {
    const raw = cur?.screens ?? {};
    const entries = Object.entries(raw);
    if (entries.length === 0) return [];

    return entries
      .map(([name, value]) => ({
        rawName: name,
        name: formatLabel(name),
        value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [cur?.screens]);

  if (!cur) return null;

  return (
    <Section
      icon="🧭"
      title="Adoption"
      question="Which features and screens earn their place — and which are dead weight?"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Features Used */}
        <Card
          title="Features Used"
          hint="Interaction frequency across all app surfaces"
        >
          {featureData.length === 0 ? (
            <NoData message="No feature interactions logged in range" />
          ) : (
            <div className="h-72 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={featureData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 30, bottom: 5 }}
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
                    width={110}
                    stroke="rgba(255,255,255,0.7)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    content={({ active, payload, label: itemLabel }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                          <p className="font-bold text-white">{itemLabel}</p>
                          <p className="text-emerald-400 mt-0.5">
                            {fmtInt(d.value)} uses
                          </p>
                          {d.topContext && (
                            <p className="text-white/40 text-[10px] mt-1">
                              Primary context:{" "}
                              <span className="text-white/70">
                                {d.topContext}
                              </span>
                            </p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="value"
                    fill="#4ADE80"
                    radius={[0, 4, 4, 0]}
                    onClick={(d: any) =>
                      openDrill("feature_used", `Feature: ${d.name}`)
                    }
                    style={{ cursor: "pointer" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Card 2: Screen Visits */}
        <Card title="Screen Visits" hint="Most visited navigation destinations">
          {screenData.length === 0 ? (
            <NoData message="No screen views logged in range" />
          ) : (
            <div className="h-72 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={screenData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 30, bottom: 5 }}
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
                    width={100}
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
                          <p className="font-bold text-white">{itemLabel}</p>
                          <p className="text-sky-400 mt-0.5">
                            {fmtInt(payload[0].value as number)} visits
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="value"
                    fill="#5B9CF6"
                    radius={[0, 4, 4, 0]}
                    onClick={(d: any) =>
                      openDrill("screen_view", `Screen: ${d.rawName}`)
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
