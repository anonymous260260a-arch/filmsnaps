"use client";

/**
 * /admin — Telemetry dashboard (anonymous aggregates only).
 *
 * Auth: HTTP Basic (ADMIN_TOKEN) enforced by middleware.ts for /admin and the
 * dashboard API. The browser prompts for credentials and replays them
 * automatically on fetch calls — no token plumbing here.
 *
 * Redesigned with modular architecture, Recharts data visualization, and
 * actionable product insight cards.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Dashboard, DrillState, Range } from "./components/types";
import { dayStr, sum } from "./components/utils";
import { GOLD } from "./components/constants";
import { Section, Card, Skeleton } from "./components/shared";

// Section components
import { DashboardHeader } from "./components/DashboardHeader";
import { KpiStrip } from "./components/KpiStrip";
import { PlaybackFunnel } from "./components/PlaybackFunnel";
import { EventTrend } from "./components/EventTrend";
import { EngagementSection } from "./components/EngagementSection";
import { PlaybackQuality } from "./components/PlaybackQuality";
import { ReliabilitySection } from "./components/ReliabilitySection";
import { AdoptionSection } from "./components/AdoptionSection";
import { EventVolume } from "./components/EventVolume";
import { DrillDrawer } from "./components/DrillDrawer";

export default function AdminPage() {
  const [range, setRange] = useState<Range>({ kind: "preset", days: 7 });
  const [cur, setCur] = useState<Dashboard | null>(null);
  const [prev, setPrev] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillState>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Resolve current range into UTC date strings + previous comparison window
  const { from, to, prevFrom, prevTo } = useMemo(() => {
    const now = Date.now();
    if (range.kind === "preset") {
      const t = dayStr(now);
      const f = dayStr(now - range.days * 86_400_000);
      const pf = dayStr(now - range.days * 2 * 86_400_000);
      return { from: f, to: t, prevFrom: pf, prevTo: f };
    }
    const fromTs = Date.parse(`${range.from}T00:00:00Z`);
    const toTs = Date.parse(`${range.to}T23:59:59Z`);
    const span = Math.max(86_400_000, toTs - fromTs);
    return {
      from: range.from,
      to: range.to,
      prevFrom: dayStr(fromTs - span),
      prevTo: dayStr(fromTs - 1),
    };
  }, [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = (f: string, t: string) =>
        `/api/telemetry/dashboard?from=${f}&to=${t}`;
      const [curRes, prevRes] = await Promise.all([
        fetch(q(from, to), { credentials: "same-origin" }),
        fetch(q(prevFrom, prevTo), { credentials: "same-origin" }),
      ]);

      if (!curRes.ok) {
        const body = (await curRes.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${curRes.status}`);
      }

      const curData = (await curRes.json()) as Dashboard;
      const prevData = prevRes.ok
        ? ((await prevRes.json()) as Dashboard)
        : null;

      setCur(curData);
      setPrev(prevData);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setCur(null);
      setPrev(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, prevFrom, prevTo]);

  useEffect(() => {
    void load();
  }, [load]);

  // Drill-down helper
  const openDrill = useCallback(
    (event: string, title: string, fromD = from, toD = to) => {
      setDrill({ event, from: fromD, to: toD, title });
    },
    [from, to],
  );

  const rangeDays =
    range.kind === "preset"
      ? range.days
      : Math.max(
          1,
          Math.round(
            (Date.parse(`${range.to}T23:59:59Z`) -
              Date.parse(`${range.from}T00:00:00Z`)) /
              86_400_000,
          ),
        );

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-white/[0.88] font-sans antialiased selection:bg-[#D4A237]/30">
      {/* ── Sticky Navigation Header ── */}
      <DashboardHeader
        range={range}
        setRange={setRange}
        from={from}
        to={to}
        loading={loading}
        onRefresh={() => void load()}
        updatedAt={updatedAt}
      />

      <main className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20">
        {/* Error State */}
        {error && (
          <div className="my-8 p-6 bg-[#141417] border border-red-500/30 rounded-2xl max-w-xl">
            <h2 className="text-lg font-bold text-white mb-2">
              Dashboard Unavailable
            </h2>
            <p className="text-sm text-white/60 leading-relaxed mb-4">
              {error === "db-unbound"
                ? "The D1 binding is not available in this runtime. Use `pnpm cf:preview` (remote Workers runtime) or deploy, then reload."
                : `API error: ${error}. Check ADMIN_TOKEN authentication and Cloudflare Worker telemetry logs.`}
            </p>
            <button
              onClick={() => void load()}
              className="px-4 py-2 bg-[#D4A237] text-[#0B0B0D] font-bold text-xs rounded-lg hover:bg-[#D4A237]/90 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Loading Skeletons */}
        {loading && !cur && !error && (
          <div className="space-y-8 mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-80 rounded-2xl" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Skeleton className="h-72 rounded-2xl" />
              <Skeleton className="h-72 rounded-2xl" />
            </div>
          </div>
        )}

        {/* Ingest Warning */}
        {cur && cur.meta?.total === 0 && (
          <div className="my-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs leading-relaxed">
            <span className="font-bold">
              No events recorded in this time range.
            </span>{" "}
            Either no users active, or the telemetry ingest worker needs
            redeployment (<code className="text-[#D4A237]">apps/web</code>) to
            ensure all event types are whitelist approved.
          </div>
        )}

        {cur && (
          <>
            {/* ── 1. At a Glance (KPIs) ── */}
            <KpiStrip cur={cur} prev={prev} rangeDays={rangeDays} />

            {/* ── 2. Playback Funnel & Daily Trend ── */}
            <Section
              icon="⚡"
              title="Playback Funnel & Event Activity"
              question="Where do watch attempts drop off between tapping a title and first frame, and how is volume trending?"
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card
                  title="Intent → Playback → Clean End"
                  hint="Click any stage to inspect raw events"
                >
                  <PlaybackFunnel
                    opened={sum(cur.funnel?.watchOpened)}
                    started={sum(cur.funnel?.playerStart)}
                    framed={cur.funnel?.playerStart?.first_frame ?? 0}
                    ended={sum(cur.p5?.completionCurve)}
                    surface={cur.funnel?.watchOpened}
                    openDrill={openDrill}
                  />
                </Card>

                <Card
                  title="Event Volume Per Day"
                  hint="Stacked by event type · click points to filter by day"
                >
                  <EventTrend
                    daily={cur.daily ?? {}}
                    onPick={(event, day) =>
                      openDrill(event, `${event} on ${day}`, day, day)
                    }
                  />
                </Card>
              </div>
            </Section>

            {/* ── 3. Engagement ── */}
            <EngagementSection cur={cur} openDrill={openDrill} />

            {/* ── 4. Playback Quality ── */}
            <PlaybackQuality cur={cur} prev={prev} openDrill={openDrill} />

            {/* ── 5. Reliability ── */}
            <ReliabilitySection cur={cur} openDrill={openDrill} />

            {/* ── 6. Adoption ── */}
            <AdoptionSection cur={cur} openDrill={openDrill} />

            {/* ── 7. Total Event Volume ── */}
            <EventVolume cur={cur} openDrill={openDrill} />
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-white/[0.06] text-xs text-white/30 flex flex-wrap items-center justify-between gap-4">
        <div>
          Anonymous aggregates only · No PII, cookies, or device fingerprinting
          stored.
        </div>
        <div className="font-mono text-[11px]">
          Comparison window: {prevFrom} to {prevTo}
        </div>
      </footer>

      {/* ── Slide-over Raw Event Drawer ── */}
      {drill && <DrillDrawer state={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}
