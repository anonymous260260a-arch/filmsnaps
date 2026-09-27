"use client";

import React from "react";
import type { Dashboard } from "./types";
import { Delta } from "./shared";
import { fmtInt, fmtMs, fmtPct, sum } from "./utils";

interface KpiStripProps {
  cur: Dashboard | null;
  prev: Dashboard | null;
  rangeDays: number;
}

export function KpiStrip({ cur, prev, rangeDays }: KpiStripProps) {
  if (!cur) return null;

  // 1. Watch Opens
  const watchOpens = sum(cur.funnel?.watchOpened);
  const prevWatchOpens = sum(prev?.funnel?.watchOpened);
  const directOpens = cur.funnel?.watchOpened?.direct ?? 0;
  const embedOpens = cur.funnel?.watchOpened?.embed ?? 0;

  // 2. Playback Success
  const psTotal = sum(cur.funnel?.playerStart);
  const psFirst = cur.funnel?.playerStart?.first_frame ?? 0;
  const psPct = psTotal > 0 ? psFirst / psTotal : 0;
  const prevPsTotal = sum(prev?.funnel?.playerStart);
  const prevPsFirst = prev?.funnel?.playerStart?.first_frame ?? 0;
  const prevPsPct = prevPsTotal > 0 ? prevPsFirst / prevPsTotal : 0;
  const abandonedCount = psTotal - psFirst;
  const isSuccessLow = psTotal > 0 && psPct < 0.85;

  // 3. Time to First Frame
  const itff = cur.p5?.intentToFirstFrame;
  const prevItff = prev?.p5?.intentToFirstFrame;
  const p50 = itff?.p50 ?? 0;
  const p90 = itff?.p90 ?? 0;
  const prevP50 = prevItff?.p50 ?? 0;

  // 4. Watched >= 50%
  const watchEnds = sum(cur.p5?.completionCurve);
  const deepEnds =
    (cur.p5?.completionCurve?.["50-75"] ?? 0) +
    (cur.p5?.completionCurve?.["75-90"] ?? 0) +
    (cur.p5?.completionCurve?.["90-100"] ?? 0);
  const completionRate = watchEnds > 0 ? deepEnds / watchEnds : 0;
  const prevWatchEnds = sum(prev?.p5?.completionCurve);
  const prevDeepEnds =
    (prev?.p5?.completionCurve?.["50-75"] ?? 0) +
    (prev?.p5?.completionCurve?.["75-90"] ?? 0) +
    (prev?.p5?.completionCurve?.["90-100"] ?? 0);
  const prevCompletionRate =
    prevWatchEnds > 0 ? prevDeepEnds / prevWatchEnds : 0;

  // 5. Sessions
  const sessions = sum(cur.sessions?.perDay?.map((d) => d.n));
  const prevSessions = sum(prev?.sessions?.perDay?.map((d) => d.n));
  const sessionsPerDay = (sessions / Math.max(1, rangeDays)).toFixed(1);

  // 6. Buffering Events
  const stallEvents =
    cur.p5?.rebuffer?.stallEvents ?? cur.funnel?.bufferStalls ?? 0;
  const prevStallEvents =
    prev?.p5?.rebuffer?.stallEvents ?? prev?.funnel?.bufferStalls ?? 0;
  const stallMs = cur.p5?.rebuffer?.stallMs ?? 0;
  const rebufCount = cur.p5?.rebuffer?.total ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5 mt-6 animate-fade-in">
      {/* 1. Watch Opens */}
      <div className="bg-[#141417] border border-white/[0.07] hover:border-white/[0.14] rounded-2xl p-4 flex flex-col justify-between transition-all">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold tracking-wider text-white/50 uppercase">
              Watch Opens
            </span>
            <Delta cur={watchOpens} prev={prevWatchOpens} />
          </div>
          <div className="text-[26px] font-extrabold text-white tabular-nums tracking-tight">
            {fmtInt(watchOpens)}
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-white/[0.05] text-[11px] text-white/40 flex items-center justify-between">
          <span>Direct {fmtInt(directOpens)}</span>
          <span>Embed {fmtInt(embedOpens)}</span>
        </div>
      </div>

      {/* 2. Playback Success */}
      <div
        className={`bg-[#141417] border rounded-2xl p-4 flex flex-col justify-between transition-all ${
          isSuccessLow
            ? "border-red-500/30 bg-red-500/[0.02]"
            : "border-white/[0.07] hover:border-white/[0.14]"
        }`}
      >
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold tracking-wider text-white/50 uppercase">
              Play Success
            </span>
            {psTotal > 0 && <Delta cur={psPct} prev={prevPsPct} />}
          </div>
          <div
            className={`text-[26px] font-extrabold tabular-nums tracking-tight ${
              isSuccessLow ? "text-red-400" : "text-white"
            }`}
          >
            {psTotal > 0 ? fmtPct(psFirst, psTotal) : "—"}
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-white/[0.05] text-[11px] text-white/40">
          {abandonedCount > 0 ? (
            <span className={isSuccessLow ? "text-red-400/80 font-medium" : ""}>
              {fmtInt(abandonedCount)} dropped before 1st frame
            </span>
          ) : (
            "100% reach first frame"
          )}
        </div>
      </div>

      {/* 3. Time to First Frame */}
      <div className="bg-[#141417] border border-white/[0.07] hover:border-white/[0.14] rounded-2xl p-4 flex flex-col justify-between transition-all">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold tracking-wider text-white/50 uppercase">
              1st Frame (p50)
            </span>
            {p50 > 0 && <Delta cur={p50} prev={prevP50} goodWhenDown />}
          </div>
          <div className="text-[26px] font-extrabold text-white tabular-nums tracking-tight">
            {p50 > 0 ? fmtMs(p50) : "—"}
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-white/[0.05] text-[11px] text-white/40 flex items-center justify-between">
          <span>p90: {p90 > 0 ? fmtMs(p90) : "—"}</span>
          <span className="text-emerald-400/70">lower is faster</span>
        </div>
      </div>

      {/* 4. Watched >= 50% */}
      <div className="bg-[#141417] border border-white/[0.07] hover:border-white/[0.14] rounded-2xl p-4 flex flex-col justify-between transition-all">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold tracking-wider text-white/50 uppercase">
              Watched ≥ 50%
            </span>
            {watchEnds > 0 && (
              <Delta cur={completionRate} prev={prevCompletionRate} />
            )}
          </div>
          <div className="text-[26px] font-extrabold text-white tabular-nums tracking-tight">
            {watchEnds > 0 ? fmtPct(deepEnds, watchEnds) : "—"}
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-white/[0.05] text-[11px] text-white/40">
          {fmtInt(deepEnds)} of {fmtInt(watchEnds)} completed
        </div>
      </div>

      {/* 5. Sessions */}
      <div className="bg-[#141417] border border-white/[0.07] hover:border-white/[0.14] rounded-2xl p-4 flex flex-col justify-between transition-all">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold tracking-wider text-white/50 uppercase">
              Sessions
            </span>
            <Delta cur={sessions} prev={prevSessions} />
          </div>
          <div className="text-[26px] font-extrabold text-white tabular-nums tracking-tight">
            {fmtInt(sessions)}
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-white/[0.05] text-[11px] text-white/40">
          ~{sessionsPerDay} sessions / day
        </div>
      </div>

      {/* 6. Buffering Events */}
      <div
        className={`bg-[#141417] border rounded-2xl p-4 flex flex-col justify-between transition-all ${
          stallEvents > 50
            ? "border-amber-500/30"
            : "border-white/[0.07] hover:border-white/[0.14]"
        }`}
      >
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold tracking-wider text-white/50 uppercase">
              Buffer Stalls
            </span>
            <Delta cur={stallEvents} prev={prevStallEvents} goodWhenDown />
          </div>
          <div className="text-[26px] font-extrabold text-white tabular-nums tracking-tight">
            {fmtInt(stallEvents)}
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-white/[0.05] text-[11px] text-white/40 flex items-center justify-between">
          <span>{fmtInt(rebufCount)} episodes</span>
          <span>{fmtMs(stallMs)} lost</span>
        </div>
      </div>
    </div>
  );
}
