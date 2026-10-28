"use client";

import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { Dashboard } from "./types";
import { fmtInt } from "./utils";
import { Section, Card, NoData } from "./shared";
import { GOLD, label } from "./constants";

interface EventInventoryProps {
  cur: Dashboard | null;
  totalUsers: number;
  openDrill: (event: string, title: string) => void;
}

export function EventInventory({
  cur,
  totalUsers,
  openDrill,
}: EventInventoryProps) {
  const eventData = useMemo(() => {
    const totals = cur?.totals ?? {};
    const features = cur?.features ?? [];

    const events: {
      name: string;
      displayName: string;
      count: number;
      users: number;
      rate: number;
      category: string;
    }[] = [];

    for (const [name, count] of Object.entries(totals)) {
      const feat = features.find((f) => f.feature === name);
      const users = feat?.users ?? 0;
      const rate = totalUsers > 0 ? (users / totalUsers) * 100 : 0;
      events.push({
        name,
        displayName: label(name),
        count,
        users,
        rate: Math.round(rate * 10) / 10,
        category: getCategory(name),
      });
    }

    for (const feat of features) {
      if (!totals[feat.feature]) {
        events.push({
          name: feat.feature,
          displayName: label(feat.feature),
          count: feat.n,
          users: feat.users,
          rate: feat.adoptionRate,
          category: "feature",
        });
      }
    }

    return events.sort((a, b) => b.count - a.count);
  }, [cur?.totals, cur?.features, totalUsers]);

  const categoryColor: Record<string, string> = {
    event: GOLD,
    feature: "#4ADE80",
    session: "#F472B6",
    quality: "#34D399",
    error: "#F87171",
  };

  const getCategory = (name: string): string => {
    if (name.startsWith("session_")) return "session";
    if (
      name.startsWith("watch_") ||
      name.startsWith("player_") ||
      name.startsWith("buffer_")
    )
      return "quality";
    if (
      name.startsWith("provider_") ||
      name.startsWith("seek_") ||
      name.startsWith("exit_")
    )
      return "quality";
    if (name === "player_error" || name === "boundary_error") return "error";
    if (name === "feature_used") return "feature";
    return "event";
  };

  if (!cur || eventData.length === 0) {
    return null;
  }

  return (
    <Section
      icon="📋"
      title="Full Event Inventory"
      question="Every telemetry event type — nothing hidden. Count, users, and adoption rate for each."
    >
      <Card
        title="All Events"
        hint="Click any bar to inspect raw events"
        className="p-0 overflow-hidden"
      >
        <div className="h-80 w-full pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={eventData}
              layout="vertical"
              margin={{ top: 5, right: 40, left: 120, bottom: 5 }}
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
                tickFormatter={(v) => fmtInt(v)}
              />
              <YAxis
                type="category"
                dataKey="displayName"
                stroke="rgba(255,255,255,0.7)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={130}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                content={({ active, payload, label: itemLabel }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                      <p className="font-bold text-white">{itemLabel}</p>
                      <p className="text-white/50 mt-0.5">
                        {fmtInt(d.count)} events
                      </p>
                      {d.users > 0 ? (
                        <p className="text-emerald-400 mt-0.5">
                          {fmtInt(d.users)} of {fmtInt(totalUsers)} users
                          <span className="text-white/40 ml-1">
                            ({d.rate}%)
                          </span>
                        </p>
                      ) : null}
                      <p className="text-white/40 text-[10px] mt-1">
                        Click to drill down
                      </p>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="count"
                fill={GOLD}
                radius={[0, 4, 4, 0]}
                onClick={(d: any) => openDrill(d.name, `Event: ${d.name}`)}
                style={{ cursor: "pointer" }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </Section>
  );
}
