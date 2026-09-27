"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { fmtInt } from "./utils";

interface PlaybackFunnelProps {
  opened: number;
  started: number;
  framed: number;
  ended: number;
  surface?: Record<string, number>;
  openDrill: (event: string, title: string) => void;
}

export function PlaybackFunnel({
  opened,
  started,
  framed,
  ended,
  surface,
  openDrill,
}: PlaybackFunnelProps) {
  const data = [
    {
      name: "Watch Opened",
      value: opened,
      event: "watch_opened",
      fill: "#D4A237",
    },
    {
      name: "Player Started",
      value: started,
      event: "player_start",
      fill: "#5B9CF6",
    },
    {
      name: "First Frame",
      value: framed,
      event: "player_start",
      fill: "#34D399",
    },
    {
      name: "Clean Watch End",
      value: ended,
      event: "watch_end",
      fill: "#A78BFA",
    },
  ];

  const getDropoff = (current: number, prev: number) => {
    if (!prev) return null;
    const pct = Math.round((current / prev) * 100);
    const isBad = pct < 80;
    return {
      text: `${pct}% ↓`,
      isBad,
    };
  };

  return (
    <div className="w-full h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 15, right: 120, left: 140, bottom: 15 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={(props: any) => {
              const { x, y, payload } = props;
              const index = payload.index;
              const item = data[index];

              return (
                <g transform={`translate(${x},${y})`}>
                  <text
                    x={-15}
                    y={0}
                    dy={item.name === "Watch Opened" && surface ? -8 : 4}
                    textAnchor="end"
                    fill="rgba(255,255,255,0.9)"
                    className="text-xs font-semibold"
                  >
                    {item.name}
                  </text>
                  {item.name === "Watch Opened" && surface && (
                    <text
                      x={-15}
                      y={14}
                      textAnchor="end"
                      fill="rgba(255,255,255,0.4)"
                      className="text-[10px]"
                    >
                      Direct {fmtInt(surface.direct || 0)} · Embed{" "}
                      {fmtInt(surface.embed || 0)}
                    </text>
                  )}
                </g>
              );
            }}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <div className="bg-[#121216] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 shadow-2xl">
                  <p className="font-bold mb-1 text-white">{p.name}</p>
                  <p style={{ color: p.fill }} className="font-semibold">
                    {fmtInt(p.value)} events
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
            minPointSize={4}
            radius={[0, 6, 6, 0]}
            onClick={(d: any) => openDrill(d.event, `Funnel: ${d.name}`)}
            style={{ cursor: "pointer" }}
            label={(props: any) => {
              const { x, y, width, height, value, index } = props;
              const item = data[index];
              const prevItem = index > 0 ? data[index - 1] : null;
              const dropoff = prevItem
                ? getDropoff(item.value, prevItem.value)
                : null;

              return (
                <g>
                  <text
                    x={x + width + 10}
                    y={y + height / 2 + 4}
                    fill="rgba(255,255,255,0.9)"
                    className="text-xs font-bold font-mono"
                  >
                    {fmtInt(value)}
                  </text>
                  {dropoff && (
                    <text
                      x={x + width + 75}
                      y={y + height / 2 + 4}
                      fill={dropoff.isBad ? "#F87171" : "rgba(255,255,255,0.4)"}
                      className="text-xs font-medium"
                    >
                      {dropoff.text}
                    </text>
                  )}
                </g>
              );
            }}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
