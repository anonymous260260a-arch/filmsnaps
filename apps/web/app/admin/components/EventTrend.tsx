"use client";

import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { TREND_SERIES, SERIES_COLORS } from "./constants";
import { fmtDay, fmtInt } from "./utils";
import { NoData } from "./shared";

interface EventTrendProps {
  daily: Record<string, Record<string, number>>;
  onPick: (event: string, day: string) => void;
}

export function EventTrend({ daily, onPick }: EventTrendProps) {
  const dates = Object.keys(daily || {}).sort();

  if (dates.length === 0) {
    return <NoData message="No daily event data available in this range" />;
  }

  // Calculate volume per series
  const seriesVolume: Record<string, number> = {};
  dates.forEach((date) => {
    Object.entries(daily[date] || {}).forEach(([series, count]) => {
      seriesVolume[series] = (seriesVolume[series] || 0) + count;
    });
  });

  const sortedSeries = Object.entries(seriesVolume)
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0]);

  const topSeries = sortedSeries.slice(0, 8);
  const hasOther = sortedSeries.length > 8;
  const seriesToRender = hasOther ? [...topSeries, "other"] : topSeries;

  const chartData = dates.map((date) => {
    const dayData = daily[date] || {};
    const item: any = { date, label: fmtDay(date) };
    let otherCount = 0;

    Object.entries(dayData).forEach(([series, count]) => {
      if (topSeries.includes(series)) {
        item[series] = count;
      } else {
        otherCount += count;
      }
    });

    if (hasOther) {
      item["other"] = otherCount;
    }

    return item;
  });

  const getColor = (seriesName: string) => {
    if (seriesName === "other") return "#64748B";
    return SERIES_COLORS[seriesName] || "#94A3B8";
  };

  const getLabel = (seriesName: string) => {
    if (seriesName === "other") return "Other";
    return seriesName.replace(/_/g, " ");
  };

  return (
    <div className="w-full flex flex-col gap-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 items-center px-1">
        {seriesToRender.map((series) => (
          <div
            key={series}
            className="flex items-center gap-1.5 text-[11px] text-white/70"
          >
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: getColor(series) }}
            />
            <span className="capitalize">{getLabel(series)}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="w-full h-64 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.04)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
              dy={6}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
              tickFormatter={(val) => fmtInt(val)}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const total = payload.reduce(
                  (acc: number, p: any) => acc + (Number(p.value) || 0),
                  0,
                );
                return (
                  <div className="bg-[#121216] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white/90 shadow-2xl min-w-[160px]">
                    <p className="font-bold text-white mb-1.5 pb-1 border-b border-white/[0.08]">
                      {label}
                    </p>
                    <div className="space-y-1">
                      {payload.map((p: any) => (
                        <div
                          key={p.dataKey}
                          className="flex items-center justify-between gap-3"
                        >
                          <span
                            style={{ color: p.color }}
                            className="capitalize text-[11px]"
                          >
                            {getLabel(p.dataKey)}
                          </span>
                          <span className="font-mono text-white/90 text-[11px]">
                            {fmtInt(p.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 pt-1 border-t border-white/[0.08] flex items-center justify-between text-white/50 text-[11px]">
                      <span>Total:</span>
                      <span className="font-mono font-bold text-white">
                        {fmtInt(total)}
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            {seriesToRender.map((series) => (
              <Area
                key={series}
                type="monotone"
                dataKey={series}
                stackId="1"
                stroke={getColor(series)}
                fill={getColor(series)}
                fillOpacity={0.45}
                activeDot={{
                  onClick: (event) => {
                    const eventDate = (
                      event as unknown as { payload?: { date?: string } }
                    ).payload?.date;
                    if (eventDate && series !== "other") {
                      onPick(series, eventDate);
                    }
                  },
                  cursor: "pointer",
                }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
