/**
 * GET /admin — telemetry dashboard behind HTTP Basic Auth.
 *
 * Auth: Authorization: Basic base64(<user>:<ADMIN_TOKEN>)
 * Env: ADMIN_TOKEN required; noindex; read-only; CSS/SVG only (no chart deps).
 *
 * S1 hardening (public repo threat model):
 *  - ADMIN_TOKEN must be >=32 random chars, e.g. `openssl rand -hex 32`.
 *  - Constant-time compare: both sides are SHA-256 hashed (crypto.subtle)
 *    before comparison. Hashing first means the compared bytes are fixed
 *    length and equal regardless of input length, and comparing digests
 *    with an early-exit loop over a *digest* leaks nothing about where the
 *    real token diverges — no byte-position timing signal for brute force.
 *  - Every failure returns the identical generic 401 (missing header,
 *    malformed header, wrong creds, unset token) — no error details, no
 *    stacks, no timing hints beyond the fixed compare itself.
 *  - All admin responses carry Cache-Control: no-store.
 *  - Panel SQL failures return an empty 500 — never partial data.
 *
 * v2 (A1–A7): shared parameterized WHERE builder across every query;
 * filters (range 7/30/90/all + provider + mediaType + connectionClass +
 * appVersion); section captions; headline row; rate panels show "(n/m)";
 * filterable recent-events + CSV export; panels cover events E1–E11.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Identical body+headers for every auth failure mode. */
function unauthorized(): NextResponse {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      ...NO_STORE,
      "WWW-Authenticate": 'Basic realm="filmsnaps-admin"',
    },
  });
}

async function sha256Hex(value: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

/** Fixed-work comparison of two SHA-256 digests (no early exit). */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function checkAuth(): Promise<boolean> {
  // Fail closed: unset ADMIN_TOKEN = /admin disabled (still generic 401).
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const h = await headers();
  const auth = h.get("authorization");
  if (!auth?.startsWith("Basic ")) return false;
  let provided: string;
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return false;
    provided = decoded.slice(idx + 1);
  } catch {
    return false;
  }
  // Hash both sides, then constant-time compare the digests (see header).
  const [providedHash, tokenHash] = await Promise.all([
    sha256Hex(provided),
    sha256Hex(token),
  ]);
  return constantTimeEqual(providedHash, tokenHash);
}

function getDB(): any | null {
  // D1 bindings are objects — OpenNext only copies *string* bindings onto
  // process.env, so read through the Cloudflare context instead.
  return (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
}

interface FilterParams {
  days: number; // 7 | 30 | 90 | 365 (all)
  provider: string | null;
  mediaType: string | null;
  connectionClass: string | null;
  appVersion: string | null;
}

/**
 * Shared WHERE clause builder (A1). Every clause is a bound parameter — no
 * string interpolation of user input anywhere. dims_json is filtered with
 * json_extract accessors per the whitelisted dim names in the ingest route.
 */
function buildWhere(f: FilterParams): { sql: string; bind: Array<string | number> } {
  const clauses: string[] = ["ts >= ?"];
  const bind: Array<string | number> = [Date.now() - f.days * 86_400_000];
  if (f.provider) {
    clauses.push("json_extract(dims_json, '$.providerId') = ?");
    bind.push(f.provider);
  }
  if (f.mediaType) {
    clauses.push("json_extract(dims_json, '$.mediaType') = ?");
    bind.push(f.mediaType);
  }
  if (f.connectionClass) {
    clauses.push("connection_class = ?");
    bind.push(f.connectionClass);
  }
  if (f.appVersion) {
    clauses.push("app_version = ?");
    bind.push(f.appVersion);
  }
  return { sql: clauses.join(" AND "), bind };
}

/** Parse a range query param into days. Only whitelisted literals survive. */
function daysForRange(raw: string | null): number {
  return raw === "30" ? 30 : raw === "90" ? 90 : raw === "all" ? 365 : 7;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}

function bar(label: string, pct: number, display: string): string {
  const w = Math.max(2, Math.min(100, pct));
  return `<div style="margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px">
      <span>${escapeHtml(label)}</span><span style="opacity:.7">${escapeHtml(display)}</span>
    </div>
    <div style="height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${w}%;background:#d4a237;border-radius:4px"></div>
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function caption(text: string): string {
  return `<p style="opacity:.55;font-size:12px;margin:-6px 0 12px">${escapeHtml(text)}</p>`;
}

function panel(title: string, cap: string, body: string): string {
  return `<section style="border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:16px;margin-bottom:16px;background:rgba(255,255,255,.03)">
    <h2 style="font-size:14px;font-weight:600;margin:0 0 8px">${escapeHtml(title)}</h2>
    ${cap ? caption(cap) : ""}${body}
  </section>`;
}

/** Headline stat card (A3). */
function card(label: string, value: string, sub?: string): string {
  return `<div style="flex:1;min-width:120px;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;background:rgba(255,255,255,.03)">
    <div style="font-size:22px;font-weight:700">${escapeHtml(value)}</div>
    <div style="font-size:12px;opacity:.6;margin-top:2px">${escapeHtml(label)}</div>
    ${sub ? `<div style="font-size:11px;opacity:.45;margin-top:2px">${escapeHtml(sub)}</div>` : ""}
  </div>`;
}

interface EventRow {
  name: string;
  ts: number;
  app_version: string | null;
  connection_class: string | null;
  dims_json: string;
}

function parseDims(row: EventRow): Record<string, unknown> {
  try {
    return JSON.parse(row.dims_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function loadEvents(f: FilterParams): Promise<EventRow[]> {
  const db = getDB();
  if (!db) return [];
  const w = buildWhere(f);
  const res = await db
    .prepare(
      `SELECT name, ts, app_version, connection_class, dims_json
       FROM telemetry_events
       WHERE ${w.sql} ORDER BY ts DESC LIMIT 50000`,
    )
    .bind(...w.bind)
    .all();
  return (res.results ?? []) as EventRow[];
}

export async function GET(req: Request) {
  if (!(await checkAuth())) return unauthorized();

  const url = new URL(req.url);
  const days = daysForRange(url.searchParams.get("range"));
  const provider = url.searchParams.get("provider")?.trim() || null;
  const mediaType = url.searchParams.get("mediaType")?.trim() || null;
  const connectionClass = url.searchParams.get("connectionClass")?.trim() || null;
  const appVersion = url.searchParams.get("appVersion")?.trim() || null;
  const fmt = url.searchParams.get("fmt");
  const f: FilterParams = { days, provider, mediaType, connectionClass, appVersion };

  // S1: panel SQL is all-or-nothing — any exception returns an empty 500,
  // never a partially-rendered dashboard.
  let events: EventRow[];
  try {
    events = await loadEvents(f);
  } catch {
    return new NextResponse("Internal Server Error", {
      status: 500,
      headers: NO_STORE,
    });
  }

  // ── CSV export (A5) — same filters as the page. ──
  if (fmt === "csv") {
    const rows = [
      ["ts_iso", "name", "app_version", "connection_class", "dims_json"],
      ...events.map((r) => [
        new Date(r.ts).toISOString(),
        r.name,
        r.app_version ?? "",
        r.connection_class ?? "",
        r.dims_json,
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="filmsnaps-telemetry-${days}d.csv"`,
      },
    });
  }

  // ── Aggregations ──
  const providerShare = new Map<string, number>();
  const mediaMix = new Map<string, number>();
  const coverage = new Map<string, { ok: number; empty: number; fail: number }>();
  const fetchByDay = new Map<string, number[]>();
  const fetchByProvider = new Map<string, number[]>();
  const probeByProvider = new Map<string, number[]>();
  const switchReasons = new Map<string, number>();
  const launch = new Map<string, { splash: number[]; content: number[]; ota: number }>();
  const playerOutcomes = new Map<string, number>();
  const playerErrorBySurface = new Map<string, Map<string, number>>();
  const screens = new Map<string, number>();
  const prefLangs = new Map<string, number>();
  const stalls = { n: 0, ms: [] as number[] };
  const searches = { n: 0, failed: 0, retriedLanded: 0 };
  const searchMode = new Map<string, number>();
  const sessions = { n: 0, dur: [] as number[], ev: [] as number[] };
  const watchEnd = {
    n: 0,
    reachedFirstFrame: 0,
    gaveUp: 0,
    rebuffer0: 0,
    duration: [] as number[],
    quality: new Map<string, number>(),
    cap: new Map<string, number>(),
  };
  const downloadEvents = {
    n: 0,
    byStage: new Map<string, number>(),
    byProvider: new Map<string, number>(),
    byFailure: new Map<string, number>(),
    byQuality: new Map<string, number>(),
  };
  const features = new Map<string, number>();
  const featureByContext = new Map<string, Map<string, number>>();
  const networkSpeed = { n: 0, mbps: new Map<string, number>(), latency: new Map<string, number>() };
  const boundaryErrors = new Map<string, number>();
  const versionCounts = new Map<string, number>();
  const connClasses = new Map<string, number>();
  const eventTotals = new Map<string, number>();

  const bump = (m: Map<string, number>, k: string, n = 1) => {
    m.set(k, (m.get(k) ?? 0) + n);
  };

  for (const row of events) {
    const dims = parseDims(row);
    const ev = row.name;
    bump(eventTotals, ev);
    if (row.app_version) bump(versionCounts, row.app_version);
    if (row.connection_class) bump(connClasses, row.connection_class);

    if (ev === "watch_end") {
      watchEnd.n += 1;
      const p = String(dims.providerId ?? "unknown");
      bump(providerShare, p);
      const mt = String(dims.mediaType ?? "unknown");
      bump(mediaMix, mt);
      const lang = String(dims.prefAudioLang ?? "auto");
      bump(prefLangs, lang);
      if (dims.reachedFirstFrame === true) watchEnd.reachedFirstFrame += 1;
      if (dims.gaveUp === true) watchEnd.gaveUp += 1;
      if (dims.rebufferCount === 0) watchEnd.rebuffer0 += 1;
      if (typeof dims.durationMs === "number") {
        watchEnd.duration.push(dims.durationMs as number);
      }
      const q = String(dims.qualityBucket ?? "unknown");
      bump(watchEnd.quality, q);
      const c = String(dims.capBucket ?? "unknown");
      bump(watchEnd.cap, c);
    }
    if (ev === "app_launch") {
      const lang = String(dims.prefAudioLang ?? "auto");
      bump(prefLangs, lang);
      const reason = String(dims.reason ?? "no-cache");
      if (!launch.has(reason)) launch.set(reason, { splash: [], content: [], ota: 0 });
      const L = launch.get(reason)!;
      if (typeof dims.splashMs === "number") L.splash.push(dims.splashMs as number);
      if (typeof dims.contentReadyMs === "number")
        L.content.push(dims.contentReadyMs as number);
      if (dims.otaApplied === true) L.ota += 1;
    }
    if (ev === "buffer_stall") {
      stalls.n += 1;
      if (typeof dims.durationMs === "number") {
        stalls.ms.push(dims.durationMs as number);
      }
      const lang = String(dims.prefAudioLang ?? "auto");
      bump(prefLangs, lang);
    }
    if (ev === "session_end") {
      sessions.n += 1;
      if (typeof dims.durationMs === "number") {
        sessions.dur.push(dims.durationMs as number);
      }
      if (typeof dims.eventCount === "number") {
        sessions.ev.push(dims.eventCount as number);
      }
      const lang = String(dims.prefAudioLang ?? "auto");
      bump(prefLangs, lang);
    }
    if (ev === "player_start") {
      const o = String(dims.outcome ?? "?");
      bump(playerOutcomes, o);
      const lang = String(dims.prefAudioLang ?? "auto");
      bump(prefLangs, lang);
    }
    if (ev === "player_error") {
      const c = String(dims.errorClass ?? "?");
      const s = String(dims.surface ?? "direct");
      if (!playerErrorBySurface.has(s)) playerErrorBySurface.set(s, new Map());
      bump(playerErrorBySurface.get(s)!, c);
      const lang = String(dims.prefAudioLang ?? "auto");
      bump(prefLangs, lang);
    }
    if (ev === "screen_view") {
      const s = String(dims.screen ?? "?");
      bump(screens, s);
    }
    if (ev === "search_performed") {
      searches.n += 1;
      if (dims.failed === true) searches.failed += 1;
      if (dims.retriedAfterFail === true) searches.retriedLanded += 1;
      const m = String(dims.mode ?? "movie_tv");
      bump(searchMode, m);
    }
    if (ev === "provider_fetch") {
      const p = String(dims.providerId ?? "unknown");
      const outcome = String(dims.outcome ?? "");
      if (outcome) {
        if (!coverage.has(p)) coverage.set(p, { ok: 0, empty: 0, fail: 0 });
        const c = coverage.get(p)!;
        if (outcome === "ok") c.ok += 1;
        else if (outcome === "empty") c.empty += 1;
        else if (outcome === "fail") c.fail += 1;
      }
      if (typeof dims.fetchMs === "number") {
        if (!fetchByProvider.has(p)) fetchByProvider.set(p, []);
        fetchByProvider.get(p)!.push(dims.fetchMs as number);
        const day = new Date(row.ts).toISOString().slice(0, 10);
        if (!fetchByDay.has(day)) fetchByDay.set(day, []);
        fetchByDay.get(day)!.push(dims.fetchMs as number);
      }
      if (typeof dims.probeMs === "number") {
        if (!probeByProvider.has(p)) probeByProvider.set(p, []);
        probeByProvider.get(p)!.push(dims.probeMs as number);
      }
    }
    if (ev === "provider_switch") {
      const reason = String(dims.reason ?? "?");
      bump(switchReasons, reason);
    }
    if (ev === "download_event") {
      downloadEvents.n += 1;
      const stage = String(dims.stage ?? "?");
      bump(downloadEvents.byStage, stage);
      const prov = String(dims.provider ?? "?");
      bump(downloadEvents.byProvider, prov);
      const fl = String(dims.failureClass ?? "");
      if (fl) bump(downloadEvents.byFailure, fl);
      const qb = String(dims.qualityBucket ?? "unknown");
      bump(downloadEvents.byQuality, qb);
    }
    if (ev === "feature_used") {
      const feat = String(dims.feature ?? "?");
      bump(features, feat);
      const ctx = String(dims.context ?? "player");
      if (!featureByContext.has(feat)) featureByContext.set(feat, new Map());
      bump(featureByContext.get(feat)!, ctx);
    }
    if (ev === "network_speed") {
      networkSpeed.n += 1;
      const m = String(dims.mbpsBucket ?? "?");
      bump(networkSpeed.mbps, m);
      const l = String(dims.latencyBucket ?? "?");
      bump(networkSpeed.latency, l);
    }
    if (ev === "boundary_error") {
      const c = String(dims.errorClass ?? "?");
      bump(boundaryErrors, c);
    }
  }

  const sum = (m: Map<string, number>) => {
    let t = 0;
    Array.from(m.values()).forEach((v) => {
      t += v;
    });
    return t || 1;
  };

  const pct = (v: number, m: number) => (m === 0 ? 0 : ((v / m) * 100).toFixed(1));

  const providerTotal = sum(providerShare);
  const mediaTotal = sum(mediaMix);

  const providerRows =
    Array.from(providerShare.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) =>
        bar(k, (v / providerTotal) * 100, `${v} (${pct(v, providerTotal)}%)`),
      )
      .join("") || "<p style='opacity:.6;font-size:13px'>No watch_end yet</p>";

  const mediaRows =
    Array.from(mediaMix.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) =>
        bar(k, (v / mediaTotal) * 100, `${v} (${pct(v, mediaTotal)}%)`),
      )
      .join("") || "<p style='opacity:.6;font-size:13px'>No media mix</p>";

  const coverageRows =
    Array.from(coverage.entries())
      .map(([p, c]) => {
        const total = c.ok + c.empty + c.fail || 1;
        return `<tr><td>${escapeHtml(p)}</td><td>${c.ok}</td><td>${c.empty}</td><td>${c.fail}</td><td>${c.ok}/${total} (${((c.ok / total) * 100).toFixed(0)}%)</td></tr>`;
      })
      .join("") ||
    "<tr><td colspan='5' style='opacity:.6'>No provider_fetch yet</td></tr>";

  const dayKeys = Array.from(fetchByDay.keys()).sort();
  const fetchSeries = dayKeys.map((d) => {
    const arr = (fetchByDay.get(d) || []).slice().sort((a: number, b: number) => a - b);
    return {
      day: d,
      median: Math.round(percentile(arr, 0.5)),
      p90: Math.round(percentile(arr, 0.9)),
    };
  });

  const timingRows = () => {
    const rows: string[] = [];
    const keys = new Set<string>();
    Array.from(fetchByProvider.keys()).forEach((k) => keys.add(k));
    Array.from(probeByProvider.keys()).forEach((k) => keys.add(k));
    Array.from(keys).sort().forEach((p) => {
      const f = (fetchByProvider.get(p) || []).slice().sort((a: number, b: number) => a - b);
      const pr = (probeByProvider.get(p) || []).slice().sort((a: number, b: number) => a - b);
      const c = coverage.get(p);
      const total = c ? c.ok + c.empty + c.fail : 0;
      const okPct = c && total > 0 ? ((c.ok / total) * 100).toFixed(0) : "–";
      const fMed = f.length ? `${percentile(f, 0.5)}ms` : "–";
      const f90 = f.length ? `${percentile(f, 0.9)}ms` : "–";
      const pMed = pr.length ? `${percentile(pr, 0.5)}ms` : "–";
      const p90 = pr.length ? `${percentile(pr, 0.9)}ms` : "–";
      rows.push(
        `<tr><td>${escapeHtml(p)}</td><td>${f.length}</td><td>${fMed}</td><td>${f90}</td><td>${pr.length}</td><td>${pMed}</td><td>${p90}</td><td style="color:${Number(okPct) >= 90 ? "#4ade80" : Number(okPct) >= 60 ? "#d4a237" : "#f87171"}">${okPct}</td></tr>`,
      );
    });
    return rows.length
      ? rows.join("")
      : "<tr><td colspan='8' style='opacity:.6'>No fetch/probe samples yet</td></tr>";
  };

  const W = 640;
  const H = 120;
  const trendBody =
    fetchSeries.length < 2
      ? `<p style='opacity:.6;font-size:13px'>Trend needs data on 2+ days — showing aggregate above instead.</p>`
      : (() => {
          const maxF = Math.max(
            1,
            ...fetchSeries.reduce<number[]>((acc, d) => acc.concat([d.median, d.p90]), []),
          );
          const pt = (i: number, v: number) => {
            const x = (i / (fetchSeries.length - 1)) * (W - 40) + 20;
            const y = H - 20 - (v / maxF) * (H - 40);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          };
          return `<svg width="${W}" height="${H}" style="max-width:100%" role="img" aria-label="fetchMs by day">
        <polyline fill="none" stroke="#d4a237" stroke-width="2" points="${fetchSeries.map((d, i) => pt(i, d.median)).join(" ")}" />
        <polyline fill="none" stroke="#60a5fa" stroke-width="2" stroke-dasharray="4 3" points="${fetchSeries.map((d, i) => pt(i, d.p90)).join(" ")}" />
        <text x="8" y="14" fill="#999" font-size="10">median gold · p90 blue · max ${maxF}ms</text>
      </svg>`;
        })();

  const responseRows = timingRows();

  const switchTotal = sum(switchReasons);
  const switchRows =
    Array.from(switchReasons.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) =>
        bar(r, (n / switchTotal) * 100, `${n} (${pct(n, switchTotal)}%)`),
      )
      .join("") || "<p style='opacity:.6;font-size:13px'>No switches</p>";

  const launchRows =
    Array.from(launch.entries())
      .map(([reason, L]) => {
        const splash = Math.round(
          percentile(
            L.splash.slice().sort((a: number, b: number) => a - b),
            0.5,
          ),
        );
        const content = Math.round(
          percentile(
            L.content.slice().sort((a: number, b: number) => a - b),
            0.5,
          ),
        );
        const otaCount = L.ota;
        return `<tr><td>${escapeHtml(reason)}</td><td>${splash}ms</td><td>${content}ms</td><td>${L.splash.length}</td><td>${otaCount}</td></tr>`;
      })
      .join("") ||
    "<tr><td colspan='5' style='opacity:.6'>No launches</td></tr>";

  const barsOf = (m: Map<string, number>) => {
    const total = sum(m);
    return (
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${escapeHtml(k)} — ${v} (${pct(v, total)}%)`)
        .join("<br/>") || "<span style='opacity:.6'>No data</span>"
    );
  };

  // Player errors grouped by surface with (n/m) breakdown.
  const errorRows = (() => {
    const roofs: string[] = [];
    const surfaces = Array.from(playerErrorBySurface.keys()).sort();
    if (surfaces.length === 0)
      return "<p style='opacity:.6;font-size:13px'>No player_error</p>";
    for (const s of surfaces) {
      const m = playerErrorBySurface.get(s)!;
      const total = sum(m);
      const lines = Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${escapeHtml(k)} — ${v}/${total} (${pct(v, total)}%)`)
        .join("<br/>");
      roofs.push(
        `<div style="margin-bottom:10px"><b style="font-size:13px">${escapeHtml(s)}</b><br/>${lines}</div>`,
      );
    }
    return roofs.join("");
  })();

  const stallRows =
    stalls.n === 0
      ? "<p style='opacity:.6;font-size:13px'>No stalls</p>"
      : (() => {
          const sorted = stalls.ms.slice().sort((a: number, b: number) => a - b);
          return [
            `<div style="margin-bottom:8px"><span style="opacity:.6">Total</span> <b>${stalls.n}</b></div>`,
            `<div style="margin-bottom:8px"><span style="opacity:.6">Median</span> <b>${percentile(sorted, 0.5)}ms</b></div>`,
            `<div><span style="opacity:.6">p90</span> <b>${percentile(sorted, 0.9)}ms</b></div>`,
          ].join("");
        })();

  const sessionRows =
    sessions.n === 0
      ? "<p style='opacity:.6;font-size:13px'>No session_end</p>"
      : (() => {
          const dur = sessions.dur.slice().sort((a: number, b: number) => a - b);
          const ev = sessions.ev.slice().sort((a: number, b: number) => a - b);
          return [
            `<div style="margin-bottom:8px"><span style="opacity:.6">Sessions</span> <b>${sessions.n}</b></div>`,
            `<div style="margin-bottom:8px"><span style="opacity:.6">Median duration</span> <b>${Math.round(percentile(dur, 0.5) / 60000)}min</b></div>`,
            `<div><span style="opacity:.6">Median events</span> <b>${Math.round(percentile(ev, 0.5))}</b></div>`,
          ].join("");
        })();

  const searchRows = `${searches.n} searches · <span style="color:#f87171">${searches.failed} failed (${searches.failed}/${searches.n})</span> · ${searches.retriedLanded} recovered after retry<br/>${barsOf(searchMode)}`;

  // Watch session shape (E1): reached first frame, gave up, abandonment.
  const watchRows =
    watchEnd.n === 0
      ? "<p style='opacity:.6;font-size:13px'>No watch sessions</p>"
      : (() => {
          const dur = watchEnd.duration.slice().sort((a: number, b: number) => a - b);
          const med = Math.round(percentile(dur, 0.5) / 60000);
          return [
            `<div style="margin-bottom:8px"><span style="opacity:.6">Sessions</span> <b>${watchEnd.n}</b></div>`,
            `<div style="margin-bottom:8px"><span style="opacity:.6">Median duration</span> <b>${med}min</b></div>`,
            `<div style="margin-bottom:8px"><span style="opacity:.6">Reached first frame</span> <b>${watchEnd.reachedFirstFrame}/${watchEnd.n} (${pct(watchEnd.reachedFirstFrame, watchEnd.n)}%)</b></div>`,
            `<div style="margin-bottom:8px"><span style="opacity:.6">Gave up (pre-first-frame abandon)</span> <b>${watchEnd.gaveUp} (${pct(watchEnd.gaveUp, watchEnd.n)}%)</b></div>`,
            `<div style="margin-bottom:8px"><span style="opacity:.6">Zero rebuffers</span> <b>${watchEnd.rebuffer0}/${watchEnd.n} (${pct(watchEnd.rebuffer0, watchEnd.n)}%)</b></div>`,
          ].join("");
        })();

  // Download lifecycle (E5) — stage n/m + failure classes.
  const downloadRows =
    downloadEvents.n === 0
      ? "<p style='opacity:.6;font-size:13px'>No download_event yet — ships with the F10 Kotlin fix release</p>"
      : (() => {
          const stageTotal = sum(downloadEvents.byStage);
          const stageLines = Array.from(downloadEvents.byStage.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${escapeHtml(k)} — ${v}/${stageTotal} (${pct(v, stageTotal)}%)`)
            .join("<br/>");
          const failTotal = sum(downloadEvents.byFailure);
          const failLines =
            failTotal <= 1
              ? ""
              : `<div style="margin-top:8px"><b style="font-size:13px">Failure classes</b><br/>${Array.from(downloadEvents.byFailure.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${escapeHtml(k)} — ${v} (${pct(v, failTotal)}%)`)
                  .join("<br/>")}</div>`;
          return `<div><b style="font-size:13px">Stages</b><br/>${stageLines}${failLines}</div>`;
        })();

  // Feature usage (E6) — feature × context table.
  const featureRows = (() => {
    const feats = Array.from(features.keys()).sort((a, b) => b[0].localeCompare(a[0]));
    if (feats.length === 0) return "<p style='opacity:.6;font-size:13px'>No feature_used events</p>";
    return feats.map((f) => {
      const ctx = featureByContext.get(f);
      const ctxStr = ctx
        ? Array.from(ctx.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => k + (v > 1 ? `x${v}` : ""))
            .join(", ")
        : "";
      return `<tr><td>${escapeHtml(f)}</td><td>${features.get(f)}</td><td style="font-size:12px;opacity:.8">${escapeHtml(ctxStr)}</td></tr>`;
    }).join("");
  })();

  // Network speed (E8) — one per completed speed test.
  const networkRows =
    networkSpeed.n === 0
      ? "<p style='opacity:.6;font-size:13px'>No completed speed tests yet</p>"
      : `<div style="margin-bottom:8px"><span style="opacity:.6">Tests</span> <b>${networkSpeed.n}</b></div>
         <b style="font-size:13px">Speed buckets</b><br/>${barsOf(networkSpeed.mbps)}
         <div style="margin-top:8px"><b style="font-size:13px">Latency buckets</b><br/>${barsOf(networkSpeed.latency)}</div>`;

  const boundaryRows = barsOf(boundaryErrors);

  // Filter drop-downs (A1) — form GET → same page with extra params.
  const filterForm = `<form method="get" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:13px;margin-bottom:16px">
    <select name="range" style="background:rgba(255,255,255,.08);color:#f4f4f5;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 8px">
      ${(["7", "30", "90", "all"] as const)
        .map((r) => {
          const value = r === "all" ? 365 : Number(r);
          const label = r === "all" ? "All time" : `${r} days`;
          return `<option value="${r}"${days === value ? " selected" : ""}>${label}</option>`;
        })
        .join("")}
    </select>
    <input name="provider" placeholder="provider id" value="${escapeHtml(provider ?? "")}" style="background:rgba(255,255,255,.08);color:#f4f4f5;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 8px" />
    <select name="mediaType" style="background:rgba(255,255,255,.08);color:#f4f4f5;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 8px">
      <option value="">mediaType</option>
      ${["movie", "tv", "anime"].map((m) => `<option value="${m}"${mediaType === m ? " selected" : ""}>${m}</option>`).join("")}
    </select>
    <select name="connectionClass" style="background:rgba(255,255,255,.08);color:#f4f4f5;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 8px">
      <option value="">connection</option>
      ${["wifi", "cellular", "unknown"].map((c) => `<option value="${c}"${connectionClass === c ? " selected" : ""}>${c}</option>`).join("")}
    </select>
    <input name="appVersion" placeholder="app version" value="${escapeHtml(appVersion ?? "")}" style="background:rgba(255,255,255,.08);color:#f4f4f5;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 8px" />
    <button type="submit" style="background:#d4a237;color:#070708;border:none;border-radius:8px;padding:6px 14px;font-weight:600;cursor:pointer">Filter</button>
    <a href="/admin?fmt=csv&range=${days === 365 ? "all" : days}&${provider ? `provider=${encodeURIComponent(provider)}&` : ""}${mediaType ? `mediaType=${mediaType}&` : ""}${connectionClass ? `connectionClass=${connectionClass}&` : ""}${appVersion ? `appVersion=${encodeURIComponent(appVersion)}` : ""}" style="color:#d4a237">Export CSV</a>
  </form>`;

  // A3 headline row.
  const headline = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    ${card("Events (range)", String(events.length))}
    ${card("Provider fetches", String(eventTotals.get("provider_fetch") ?? 0))}
    ${card("Watch sessions", String(watchEnd.n))}
    ${card("Launches", String(eventTotals.get("app_launch") ?? 0))}
    ${card("Player errors", String(eventTotals.get("player_error") ?? 0))}
    ${card("Downloads", String(downloadEvents.n))}
    ${card("Avg fetch", fetchSeries.length ? `${Math.round(percentile(fetchSeries.map((d) => d.median).sort((a, b) => a - b), 0.5))}ms` : "–")}
  </div>`;

  const recentRows =
    events
      .slice(0, 100)
      .map((r) => {
        const d = parseDims(r);
        const brief = Object.entries(d)
          .slice(0, 6)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(" ");
        const when = new Date(r.ts).toISOString().replace("T", " ").slice(0, 19);
        return `<tr><td style="white-space:nowrap">${when}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.app_version ?? "")}</td><td>${escapeHtml(r.connection_class ?? "")}</td><td style="font-size:12px;opacity:.8">${escapeHtml(brief)}</td></tr>`;
      })
      .join("") ||
    "<tr><td colspan='5' style='opacity:.6'>No events</td></tr>";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex,nofollow" />
  <title>FilmSnaps Admin — Telemetry</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#070708;color:#f4f4f5;margin:0;padding:24px}
    a{color:#d4a237;text-decoration:none}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08)}
    th{opacity:.6;font-weight:500}
    h1{font-size:20px;margin:0 0 8px}
    .muted{opacity:.55;font-size:13px;margin-bottom:16px}
  </style>
</head>
<body>
  <h1>Telemetry</h1>
  ${filterForm}
  ${headline}
  ${panel("1. Provider share", "watch_end by provider — which source actually plays to a watch session.", providerRows)}
  ${panel("2. Media mix", "watch_end mediaType split (movie vs tv).", mediaRows)}
  ${panel("3. Provider coverage", "provider_fetch link-list outcomes. ok% = share of fetches that returned a playable link list.", `<table><tr><th>Provider</th><th>ok</th><th>empty</th><th>fail</th><th>ok (n/m)</th></tr>${coverageRows}</table>`)}
  ${panel("4. Response times by provider", "fetchMs = link-list fetch latency; probeMs = first-link validation. med/p90 in ms.", `<table style="margin-bottom:14px"><tr><th>Provider</th><th>fetch n</th><th>fetch med</th><th>fetch p90</th><th>probe n</th><th>probe med</th><th>probe p90</th><th>ok%</th></tr>${responseRows}</table>${trendBody}`)}
  ${panel("5. Switch rate by reason", "provider_switch reasons (auto-fallback, manual, stall). n/m = reason share of all switches.", switchRows)}
  ${panel("6. Launch health", "app_launch by cold-start reason. OTA = launches served from an OTA bundle (E7).", `<table><tr><th>Reason</th><th>Median splash</th><th>Median contentReady</th><th>n</th><th>OTA</th></tr>${launchRows}</table>`)}
  ${panel("7. Player start outcomes", "player_start outcome distribution.", barsOf(playerOutcomes))}
  ${panel("8. Watch session shape", "E1 signal: first-frame reach, pre-first-frame abandonment, zero-rebuffer share, median session length. buffer_stall counts are direct-surface only (E11).", watchRows)}
  ${panel("9. Player errors by surface", "player_error class broken down by surface (direct / embed / route). n/m = class share within each surface.", errorRows)}
  ${panel("10. Buffer stalls", "buffer_stall duration stats. Only the direct (native) surface emits stalls — the embed surface has no stall detector (E11).", stallRows)}
  ${panel("11. Video quality vs speed cap", "watch_end chosen qualityBucket vs capBucket (what the connection speed should have allowed). Compares whether users saw max quality.", `<div style="margin-bottom:8px"><b style="font-size:13px">Chosen quality</b><br/>${barsOf(watchEnd.quality)}</div><div style="margin-top:8px"><b style="font-size:13px">Speed cap</b><br/>${barsOf(watchEnd.cap)}</div>`)}
  ${panel("12. Screen views", "screen_view hits by route.", barsOf(screens))}
  ${panel("13. Search health", "search_performed: total vs failed (n/m), recovered-after-failure count, and mode split (E4).", searchRows)}
  ${panel("14. Session shape", "foreground sessions: median duration + events per session.", sessionRows)}
  ${panel("15. Preferred audio language", "prefAudioLang distribution across watch events.", barsOf(prefLangs))}
  ${panel("16. Download lifecycle", "download_event stages + failure classes (E5). Ships with the F10 Kotlin fix.", downloadRows)}
  ${panel("17. Feature usage", "feature_used: each feature name with its usage contexts (E6).", `<table><tr><th>Feature</th><th>n</th><th>Contexts</th></tr>${featureRows}</table>`)}
  ${panel("18. Network speed", "network_speed: one emit per completed speed test (E8), bucketed only.", networkRows)}
  ${panel("19. Boundary errors", "boundary_error coarse classes from the app error boundary (E9).", boundaryRows)}
  ${panel("20. Versions & connections", "app_version and connection_class distribution for the current filter.", `<div style="margin-bottom:8px"><b style="font-size:13px">App versions</b><br/>${barsOf(versionCounts)}</div><div style="margin-top:8px"><b style="font-size:13px">Connection classes</b><br/>${barsOf(connClasses)}</div>`)}
  ${panel("Recent events (filtered, newest 100)", `Matches the filters above; export the full set via CSV.`, `<table><tr><th>Time (UTC)</th><th>Event</th><th>Version</th><th>Conn</th><th>Dims</th></tr>${recentRows}</table>`)}
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}