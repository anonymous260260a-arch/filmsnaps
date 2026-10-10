/**
 * GET /api/telemetry/dashboard?days=7|30|90&from=YYYY-MM-DD&to=YYYY-MM-DD&event=<name>
 *
 * Aggregates telemetry_events into dashboard-shaped buckets. Anonymous
 * aggregates only — no IPs, no identifiers.
 *
 * Auth: HTTP Basic (ADMIN_TOKEN) enforced by middleware.ts — same model as the
 * original admin route. This handler therefore only needs to serve data.
 *
 * Dev note: getCloudflareContext() requires initOpenNextCloudflareForDev() in
 * next.config. When unavailable (raw `next dev` without it), we return 503
 * db-unbound instead of crashing — the dashboard shows a clean error.
 *
 * Response:
 *   meta      — range info
 *   audience  — distinct anonymous installs (per day + total, events/install)
 *   daily     — per-day event counts by name (trend chart)
 *   funnel    — watch_opened surface split + feature adoption counts
 *   features  — feature_used counts by feature
 *   screens   — screen_view counts (dwell proxy) + session_end lastScreen
 *   sessions  — session length buckets + close-from-screen histogram
 *   players   — player_start outcomes, buffer stalls, provider switches
 *   p5        — completion curve, seek latency, exit-during-switch,
 *               time-of-day histogram, sessions per day
 */
import { NextResponse } from "next/server";

const MAX_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * D1 binding lookup. In production (OpenNext on Workers) this reads the real
 * binding from the Cloudflare context. In local `next dev` the context is not
 * initialized — we detect the throw and return null so the API degrades to a
 * clean 503 instead of an unhandled 500.
 */
async function getDB(): Promise<any | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
  } catch {
    // Local dev without initOpenNextCloudflareForDev(), or non-Workers deploy.
    return null;
  }
}

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  if (process.env.TELEMETRY_ENABLED === "0") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }

  const db = await getDB();
  if (!db) {
    return NextResponse.json({ error: "db-unbound" }, { status: 503 });
  }

  // ── Range resolution ──
  const url = new URL(req.url);
  const now = Date.now();
  let fromTs: number;
  let toTs: number = now;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    fromTs = new Date(`${from}T00:00:00Z`).getTime();
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      toTs = new Date(`${to}T23:59:59Z`).getTime();
    }
  } else {
    const days = Math.min(
      MAX_DAYS,
      Math.max(1, Number(url.searchParams.get("days")) || 7),
    );
    fromTs = now - days * DAY_MS;
  }
  const fromDay = isoDay(fromTs);
  const toDay = isoDay(toTs);
  const eventName = url.searchParams.get("event") ?? null;

  // Drill-down mode: raw recent rows for one event name (no aggregates).
  // Powers the dashboard's "click a card → see the actual events" flow.
  // Supports appVersion/anonId filters for admin deep-dives.
  if (url.searchParams.get("mode") === "raw" && eventName) {
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit")) || 30),
    );
    // Build raw-mode filters.
    const rawFilterClauses: string[] = [];
    const rawFilterParams: unknown[] = [];
    const rv = url.searchParams.get("appVersion")?.trim();
    const ra = url.searchParams.get("anonId")?.trim();
    if (rv) {
      rawFilterClauses.push("app_version = ?");
      rawFilterParams.push(rv);
    }
    if (ra) {
      rawFilterClauses.push("anon_id = ?");
      rawFilterParams.push(ra);
    }
    const rawFilterSql =
      rawFilterClauses.length > 0
        ? ` AND ${rawFilterClauses.join(" AND ")}`
        : "";
    try {
      const rawRes = await db
        .prepare(
          `SELECT name, ts, app_version AS appVersion, connection_class AS connectionClass,
                  device_tier AS deviceTier, anon_id AS anonId, dims_json AS dims
           FROM telemetry_events
           WHERE ts >= ?1 AND ts <= ?2 AND name = ?3${rawFilterSql}
           ORDER BY ts DESC LIMIT ?4`,
        )
        .bind(fromTs, toTs, eventName, limit, ...rawFilterParams)
        .all();
      const rows = (rawRes.results ?? []).map((r: any) => {
        let dims: Record<string, unknown> = {};
        try {
          dims = JSON.parse(String(r.dims ?? "{}"));
        } catch {}
        // Privacy: only an 8-char prefix of the anonymous install ID ever
        // leaves the server (enough to correlate rows, useless to link).
        const anonId =
          typeof r.anonId === "string" && r.anonId.length >= 8
            ? r.anonId.slice(0, 8)
            : null;
        return { ...r, ts: Number(r.ts), anonId, dims };
      });
      return NextResponse.json(
        { meta: { fromDay, toDay, event: eventName }, rows },
        {
          headers: { "cache-control": "no-store" },
        },
      );
    } catch (e) {
      console.error("[dashboard] raw drill-down failed", e);
      return NextResponse.json({ error: "aggregate-failed" }, { status: 500 });
    }
  }

  const rangeWhere = "ts >= ?1 AND ts <= ?2";
  const params: unknown[] = [fromTs, toTs];
  if (eventName) {
    params.push(eventName);
  }
  const eventClause = eventName ? " AND name = ?3" : "";

  try {
    // Build filter clause for appVersion / anonId (admin-only debug filters).
    // These are additive to the time range — they let admins inspect a single
    // app version or trace one anonymous install's full event stream.
    const filterClauses: string[] = [];
    const filterParams: unknown[] = [];
    const appVersion = url.searchParams.get("appVersion")?.trim();
    const anonId = url.searchParams.get("anonId")?.trim();
    if (appVersion) {
      filterClauses.push("app_version = ?");
      filterParams.push(appVersion);
    }
    if (anonId) {
      filterClauses.push("anon_id = ?");
      filterParams.push(anonId);
    }
    const filterSql =
      filterClauses.length > 0 ? ` AND ${filterClauses.join(" AND ")}` : "";
    const allParams = [...params, ...filterParams];

    // ── Daily counts by event name ──
    const dailyRes = await db
      .prepare(
        `SELECT (ts / 86400000) * 86400000 AS dayStart, name, COUNT(*) AS n
       FROM telemetry_events
       WHERE ${rangeWhere}${eventClause}${filterSql}
       GROUP BY dayStart, name
       ORDER BY dayStart`,
      )
      .bind(...allParams)
      .all();

    // ── Audience: distinct anonymous installs (random per-install UUIDs,
    //    aggregate-only). Unique viewers per day + totals for the range. ──
    const audienceDayRes = await db
      .prepare(
        `SELECT (ts / 86400000) * 86400000 AS dayStart,
                COUNT(DISTINCT anon_id) AS uniques
         FROM telemetry_events
         WHERE ${rangeWhere} AND anon_id IS NOT NULL${filterSql}
         GROUP BY dayStart ORDER BY dayStart`,
      )
      .bind(...allParams)
      .all();
    const audienceTotalRes = await db
      .prepare(
        `SELECT COUNT(DISTINCT anon_id) AS uniques, COUNT(*) AS events
         FROM telemetry_events
         WHERE ${rangeWhere} AND anon_id IS NOT NULL${filterSql}`,
      )
      .bind(...allParams)
      .first();

    // ── watch_end by surface (direct native vs embed webview) — the
    //    "hours watched" numbers used to be embed-blind. ──
    const watchEndSurfaceRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.surface') AS surface, COUNT(*) AS n,
                SUM(json_extract(dims_json, '$.durationMs')) AS durMs
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'watch_end'${filterSql}
         GROUP BY surface`,
      )
      .bind(...allParams)
      .all();

    // ── feature_used breakdown ──
    const featuresRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.feature') AS feature,
                json_extract(dims_json, '$.context') AS context,
                COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'feature_used'${filterSql}
         GROUP BY feature, context ORDER BY n DESC`,
      )
      .bind(...allParams)
      .all();

    // ── Feature adoption rates: for each feature, how many DISTINCT anonIds
    //    used it vs total distinct anonIds in range. This gives "X out of Y
    //    users" instead of raw counts. ──
    const featureAdoptRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.feature') AS feature,
                COUNT(DISTINCT anon_id) AS users
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'feature_used'${filterSql}
         GROUP BY feature ORDER BY users DESC`,
      )
      .bind(...allParams)
      .all();

    // Total distinct users in range (for adoption rate denominator).
    const totalUsersRes = await db
      .prepare(
        `SELECT COUNT(DISTINCT anon_id) AS totalUsers
         FROM telemetry_events
         WHERE ${rangeWhere} AND anon_id IS NOT NULL${filterSql}`,
      )
      .bind(...allParams)
      .first();
    const totalUsers = Number(totalUsersRes?.totalUsers ?? 0);

    // ── watch funnel: watch_opened by surface ──
    const funnelRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.surface') AS surface, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'watch_opened'${filterSql}
         GROUP BY surface`,
      )
      .bind(...allParams)
      .all();

    // ── player_start outcomes + errors ──
    const playerStartRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.outcome') AS outcome, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'player_start'${filterSql}
         GROUP BY outcome`,
      )
      .bind(...allParams)
      .all();
    const playerErrRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.errorClass') AS errorClass,
                json_extract(dims_json, '$.surface') AS surface, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'player_error'${filterSql}
         GROUP BY errorClass, surface ORDER BY n DESC`,
      )
      .bind(...allParams)
      .all();

    // ── screen adoption + session close-from-screen ──
    const screensRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.screen') AS screen, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'screen_view'
         GROUP BY screen ORDER BY n DESC`,
      )
      .bind(fromTs, toTs)
      .all();
    const closeScreenRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.lastScreen') AS screen, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'session_end'
         GROUP BY screen ORDER BY n DESC`,
      )
      .bind(fromTs, toTs)
      .all();
    const sessionDurRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.durationMs') AS dur, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'session_end'
         GROUP BY dur ORDER BY n DESC LIMIT 20`,
      )
      .bind(fromTs, toTs)
      .all();

    // ── provider switches + stalls ──
    const switchRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.reason') AS reason, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'provider_switch'${filterSql}
         GROUP BY reason ORDER BY n DESC`,
      )
      .bind(...allParams)
      .all();
    const stallRes = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'buffer_stall'${filterSql}`,
      )
      .bind(...allParams)
      .first();

    // ── Playback health: chosen-quality distribution + rebuffer load ──
    const qualityRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.qualityBucket') AS bucket, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'watch_end'${filterSql}
         GROUP BY bucket`,
      )
      .bind(...allParams)
      .all();
    const rebufRes = await db
      .prepare(
        `SELECT SUM(json_extract(dims_json, '$.rebufferCount')) AS total,
                SUM(json_extract(dims_json, '$.stallMs')) AS stallMs,
                COUNT(*) AS sessions
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'watch_end'${filterSql}`,
      )
      .bind(...allParams)
      .first();

    // ── Intent→first-frame percentiles (raw sorted values, cheap at this
    //    table size; capped so a huge range cannot flood memory) ──
    const itffRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.intentToFirstFrameMs') AS ms
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'player_start'${filterSql}
         ORDER BY ms LIMIT 2000`,
      )
      .bind(...allParams)
      .all();
    const itffVals = (itffRes.results ?? [])
      .map((r: any) => Number(r.ms))
      .filter((n: number) => Number.isFinite(n))
      .sort((a: number, b: number) => a - b);
    const pct = (arr: number[], p: number) =>
      arr.length === 0
        ? 0
        : arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
    const intentToFirstFrame = {
      p50: pct(itffVals, 50),
      p90: pct(itffVals, 90),
      n: itffVals.length,
    };

    // ── P5: completion curve (watch_end.watchedPctBucket) ──
    const completionRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.watchedPctBucket') AS bucket, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'watch_end'${filterSql}
         GROUP BY bucket`,
      )
      .bind(...allParams)
      .all();

    // ── P5: resume correction rate ──
    const resumeRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.resumeCorrection') AS corrected, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'watch_end'${filterSql}
         GROUP BY corrected`,
      )
      .bind(...allParams)
      .all();

    // ── P5: seek latency by kind (raw ms → client-side p50/p95 compute) ──
    const seekRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.kind') AS kind, COUNT(*) AS n,
                AVG(json_extract(dims_json, '$.latencyMs')) AS avgMs,
                MAX(json_extract(dims_json, '$.latencyMs')) AS maxMs
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'seek_latency'${filterSql}
         GROUP BY kind`,
      )
      .bind(...allParams)
      .all();

    // ── P5: exit-during-switch ──
    const exitSwitchRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.switchKind') AS kind, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'exit_during_switch'${filterSql}
         GROUP BY kind`,
      )
      .bind(...allParams)
      .all();

    // ── P5: time-of-day histogram of watch_opened (UTC hour) ──
    const hourRes = await db
      .prepare(
        `SELECT (ts / 3600000) % 24 AS hour, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'watch_opened'${filterSql}
         GROUP BY hour ORDER BY hour`,
      )
      .bind(...allParams)
      .all();

    // ── P5: sessions per day ──
    const sessionsDayRes = await db
      .prepare(
        `SELECT (ts / 86400000) * 86400000 AS dayStart, COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'session_end'${filterSql}
         GROUP BY dayStart ORDER BY dayStart`,
      )
      .bind(...allParams)
      .all();

    // ── M1: candidate ad-slot impressions (separate section — used for the
    //    monetization decision; the app ships NO ads yet). Per-slot totals +
    //    reach, plus the daily series for the trend chart. Bound WITHOUT the
    //    ?event param (no eventClause here) — only range + filters. ──
    const slotParams = [fromTs, toTs, ...filterParams];
    const slotRes = await db
      .prepare(
        `SELECT json_extract(dims_json, '$.slot') AS slot,
                json_extract(dims_json, '$.screen') AS screen,
                COUNT(*) AS views,
                COUNT(DISTINCT anon_id) AS users,
                COUNT(DISTINCT (ts / 86400000)) AS activeDays
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'ad_slot_view'${filterSql}
         GROUP BY slot, screen
         ORDER BY views DESC`,
      )
      .bind(...slotParams)
      .all();
    const slotDayRes = await db
      .prepare(
        `SELECT (ts / 86400000) * 86400000 AS dayStart,
                json_extract(dims_json, '$.slot') AS slot,
                COUNT(*) AS n
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'ad_slot_view'${filterSql}
         GROUP BY dayStart, slot
         ORDER BY dayStart`,
      )
      .bind(...slotParams)
      .all();

    // ── Totals by event (compact) ──
    const totalsRes = await db
      .prepare(
        `SELECT name, COUNT(*) AS n FROM telemetry_events
         WHERE ${rangeWhere}${eventClause}${filterSql}
         GROUP BY name ORDER BY n DESC`,
      )
      .bind(...allParams)
      .all();

    const daily: Record<string, Record<string, number>> = {};
    let total = 0;
    for (const row of dailyRes.results ?? []) {
      const day = isoDay(Number(row.dayStart));
      daily[day] = daily[day] ?? {};
      daily[day][row.name as string] = Number(row.n);
      total += Number(row.n);
    }

    const byName = (rows: any[], key: string) =>
      Object.fromEntries(
        (rows ?? []).map((r: any) => [
          String(r[key] ?? "unknown"),
          Number(r.n),
        ]),
      );

    // Feature adoption: merge raw counts with distinct-user counts.
    const featureAdoptMap = new Map<string, number>();
    for (const r of featureAdoptRes.results ?? []) {
      featureAdoptMap.set(String(r.feature ?? "unknown"), Number(r.users));
    }

    const sessionDurBuckets: Record<string, number> = {};
    for (const row of sessionDurRes.results ?? []) {
      const ms = Number(row.dur);
      const label =
        ms < 60_000
          ? "<1m"
          : ms < 300_000
            ? "1-5m"
            : ms < 900_000
              ? "5-15m"
              : ms < 1_800_000
                ? "15-30m"
                : ms < 3_600_000
                  ? "30-60m"
                  : "60m+";
      sessionDurBuckets[label] =
        (sessionDurBuckets[label] ?? 0) + Number(row.n);
    }

    // ── M1: ad-slot impressions — merge with screen_view denominators so
    //    the dashboard can show what % of screen visits reached the slot. ──
    const screenVisitMap = new Map<string, number>();
    for (const row of screensRes.results ?? []) {
      screenVisitMap.set(String(row.screen ?? "unknown"), Number(row.n));
    }
    let slotTotalViews = 0;
    const slotTotalUsersRes = await db
      .prepare(
        `SELECT COUNT(DISTINCT anon_id) AS users
         FROM telemetry_events
         WHERE ${rangeWhere} AND name = 'ad_slot_view'
           AND anon_id IS NOT NULL${filterSql}`,
      )
      .bind(...slotParams)
      .first();
    const impressionSlots = (slotRes.results ?? []).map((r: any) => {
      const views = Number(r.views);
      const activeDays = Math.max(1, Number(r.activeDays));
      const screen = String(r.screen ?? "unknown");
      const screenViews = screenVisitMap.get(screen) ?? 0;
      slotTotalViews += views;
      return {
        slot: String(r.slot ?? "unknown"),
        screen,
        views,
        users: Number(r.users),
        avgPerDay: Math.round((views / activeDays) * 10) / 10,
        activeDays,
        screenViews,
        fillRate:
          screenViews > 0 ? Math.round((views / screenViews) * 100) : null,
      };
    });

    return NextResponse.json(
      {
        meta: { fromDay, toDay, event: eventName, total },
        audience: {
          uniquesTotal: Number(audienceTotalRes?.uniques ?? 0),
          eventsPerInstall:
            Number(audienceTotalRes?.uniques ?? 0) > 0
              ? Math.round(
                  (Number(audienceTotalRes?.events ?? 0) /
                    Number(audienceTotalRes?.uniques ?? 1)) *
                    10,
                ) / 10
              : 0,
          uniquesByDay: (audienceDayRes.results ?? []).map((r: any) => ({
            day: isoDay(Number(r.dayStart)),
            n: Number(r.uniques),
          })),
        },
        daily,
        funnel: {
          watchOpened: byName(funnelRes.results, "surface"),
          watchEndSurface: (watchEndSurfaceRes.results ?? []).map((r: any) => ({
            surface: String(r.surface ?? "unknown"),
            n: Number(r.n),
            durMs: Number(r.durMs ?? 0),
          })),
          playerStart: byName(playerStartRes.results, "outcome"),
          playerErrors: (playerErrRes.results ?? []).map((r: any) => ({
            errorClass: r.errorClass,
            surface: r.surface,
            n: Number(r.n),
          })),
          providerSwitches: byName(switchRes.results, "reason"),
          bufferStalls: Number(stallRes?.n ?? 0),
        },
        features: (featuresRes.results ?? []).map((r: any) => ({
          feature: String(r.feature ?? "unknown"),
          context: String(r.context ?? ""),
          n: Number(r.n),
          users: featureAdoptMap.get(String(r.feature ?? "unknown")) ?? 0,
          adoptionRate:
            totalUsers > 0
              ? Math.round(
                  ((featureAdoptMap.get(String(r.feature ?? "unknown")) ?? 0) /
                    totalUsers) *
                    1000,
                ) / 10
              : 0,
        })),
        screens: byName(screensRes.results, "screen"),
        impressions: {
          note: "view = slot rendered while its screen was focused (tierA). Above-fold slots (home_hero, announcements_page) are exact; below-fold slots are visit-based upper bounds until viewport tracking (tierB) ships. No ads run in the app — measurement only.",
          slots: impressionSlots,
          byDay: (slotDayRes.results ?? []).map((r: any) => ({
            day: isoDay(Number(r.dayStart)),
            slot: String(r.slot ?? "unknown"),
            n: Number(r.n),
          })),
          totalViews: slotTotalViews,
          totalUsers: Number(slotTotalUsersRes?.users ?? 0),
        },
        sessions: {
          closeFromScreen: byName(closeScreenRes.results, "screen"),
          durationBuckets: sessionDurBuckets,
          perDay: (sessionsDayRes.results ?? []).map((r: any) => ({
            day: isoDay(Number(r.dayStart)),
            n: Number(r.n),
          })),
        },
        p5: {
          completionCurve: byName(completionRes.results, "bucket"),
          resumeCorrection: byName(resumeRes.results, "corrected"),
          seekLatency: (seekRes.results ?? []).map((r: any) => ({
            kind: String(r.kind ?? "unknown"),
            n: Number(r.n),
            avgMs: Math.round(Number(r.avgMs ?? 0)),
            maxMs: Number(r.maxMs ?? 0),
          })),
          exitDuringSwitch: byName(exitSwitchRes.results, "kind"),
          watchHourHistogram: (hourRes.results ?? []).map((r: any) => ({
            hour: Number(r.hour),
            n: Number(r.n),
          })),
          intentToFirstFrame,
          qualityDist: byName(qualityRes.results, "bucket"),
          rebuffer: {
            total: Number(rebufRes?.total ?? 0),
            stallMs: Number(rebufRes?.stallMs ?? 0),
            sessions: Number(rebufRes?.sessions ?? 0),
            stallEvents: Number(stallRes?.n ?? 0),
          },
        },
        totals: byName(totalsRes.results, "name"),
        totalUsers,
        filters: {
          appVersion: appVersion ?? null,
          anonId: anonId ?? null,
          event: eventName,
          fromDay,
          toDay,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[dashboard] aggregate failed", e);
    return NextResponse.json({ error: "aggregate-failed" }, { status: 500 });
  }
}
