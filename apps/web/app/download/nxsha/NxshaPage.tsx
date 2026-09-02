"use client";

/**
 * Nxsha Download Page — desktop port of mobile's download/nxsha/[...id].tsx.
 *
 * The main process runs a hidden scraper (media-sources.ts) that loads
 * web.nxsha.app, auto-solves the arithmetic CAPTCHA and extracts direct file
 * links; states stream here over nxsha:state. Links are grouped into server
 * accordion cards (MbPly first), parsed for quality/audio/size/format, and
 * enqueued into the Download Manager via download:start.
 *
 * Route: /download/nxsha?type=movie&id={tmdbId} · /download/nxsha?type=tv&id={tmdbId}&season={s}&episode={e}
 */

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
} from "lucide-react";
import { Header } from "@/components/Header";
import { PageShell } from "@/components/PageShell";
import {
  isDownloadAvailable,
  startDownload,
  useDownloadList,
} from "@/lib/downloadStore";
import {
  getExt,
  organizeServers,
  sortParsedLinks,
  type NxshaServer,
  type ParsedLink,
} from "@/lib/nxshaLinks";

type Phase = "loading" | "solving" | "links" | "no-links" | "failed";

const QUALITY_DISPLAY: Record<string, string> = {
  "4k": "4K",
  "2160p": "4K",
  fhd: "1080p",
  hd: "720p",
  sd: "480p",
  m3u8: "M3U8",
};

const QUALITY_COLORS: Record<string, string> = {
  "4k": "#D4A237",
  "2160p": "#D4A237",
  "1440p": "#C98A2E",
  "1080p": "#B45309",
  "720p": "#A1A1AA",
  "480p": "#64748B",
  "360p": "#71717A",
  m3u8: "#60A5FA",
};

function qualityColor(link: ParsedLink): string {
  return QUALITY_COLORS[link.quality] ?? "#D4A237";
}

export default function NxshaDownloadPage() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type") === "tv" ? "tv" : "movie";
  const id = searchParams.get("id") ?? "";
  const isTV = type === "tv";

  const [pickedSeason, setPickedSeason] = useState<number>(
    searchParams.get("season") ? Number(searchParams.get("season")) : 1,
  );
  const [pickedEpisode, setPickedEpisode] = useState<number>(
    searchParams.get("episode") ? Number(searchParams.get("episode")) : 1,
  );
  // Bumped by the picker's Load button to force a re-scrape.
  const [scrapeKey, setScrapeKey] = useState(0);

  const available = isDownloadAvailable();
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusText, setStatusText] = useState("");
  const [servers, setServers] = useState<NxshaServer[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const downloads = useDownloadList();

  const effectiveSeason = pickedSeason || 1;
  const effectiveEpisode = pickedEpisode || 1;

  // ── Scrape lifecycle: subscribe, kick off, cancel on unmount ──
  useEffect(() => {
    if (!available || !id) return;
    const api = window.electronAPI;
    if (!api?.nxsha) return;

    setPhase("loading");
    setStatusText("");
    setServers([]);
    setError("");
    setExpanded({});

    let alive = true;
    const unsubscribe = api.nxsha.onState((state) => {
      if (!alive) return;
      switch (state.phase) {
        case "loading":
          setPhase("loading");
          setStatusText(state.status ?? "");
          break;
        case "solving":
          setPhase("solving");
          break;
        case "links":
          setStatusText("");
          if (state.servers?.length) {
            setServers(state.servers);
            setExpanded({ 0: true }); // expand first server by default
          }
          setPhase("links");
          break;
        case "no-links":
          setPhase("no-links");
          setError(state.error || "No download links found");
          break;
        case "failed":
          setPhase("failed");
          setError(state.error || "Scrape failed");
          break;
      }
    });

    void api.nxsha.scrape({
      type,
      id,
      season: isTV ? effectiveSeason : undefined,
      episode: isTV ? effectiveEpisode : undefined,
    });

    return () => {
      alive = false;
      unsubscribe();
      void api.nxsha?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, id, type, effectiveSeason, effectiveEpisode, scrapeKey]);

  const organized = useMemo(() => organizeServers(servers), [servers]);
  const totalLinks = useMemo(
    () => organized.reduce((acc, s) => acc + s.parsed.length, 0),
    [organized],
  );

  const handleDownload = (link: ParsedLink) => {
    if (!id) return;
    const ext = getExt(link.downloadUrl);
    const qualityStr = link.quality ? `-${link.quality}` : "";
    const serverClean = link.server.replace(/[^a-zA-Z0-9]/g, "");
    const ss = String(effectiveSeason).padStart(2, "0");
    const ee = String(effectiveEpisode).padStart(2, "0");
    // Prefer the provider's own release name; fall back to our compact scheme.
    const title =
      link.filename ||
      (isTV
        ? `nxsha-S${ss}E${ee}${qualityStr}-${serverClean}.${ext}`
        : `nxsha${qualityStr}-${serverClean}.${ext}`);

    startDownload({
      url: link.downloadUrl,
      title,
      tmdbId: id,
      mediaType: type,
      season: isTV ? effectiveSeason : undefined,
      episode: isTV ? effectiveEpisode : undefined,
    });
  };

  if (!available) {
    return (
      <div className="min-h-screen bg-[#070708] text-foreground">
        <Header />
        <PageShell maxWidth="2xl">
          <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-14 text-center">
            <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center mx-auto mb-5">
              <Download className="h-8 w-8 text-[#D4A237]" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">
              Downloads need the desktop app
            </h1>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Nxsha downloads run inside FilmSnaps Desktop. Install it to grab
              movies and episodes offline.
            </p>
            <Link
              href="/download"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
            >
              Get FilmSnaps Desktop
            </Link>
          </div>
        </PageShell>
      </div>
    );
  }

  if (!id) {
    return (
      <div className="min-h-screen bg-[#070708] text-foreground">
        <Header />
        <PageShell maxWidth="2xl" className="text-center">
          <AlertCircle className="h-10 w-10 text-[#E05252] mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Download unavailable</h1>
          <Link href="/" className="text-sm text-[#D4A237] hover:underline">
            Go home
          </Link>
        </PageShell>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070708] text-foreground">
      <Header />
      <PageShell maxWidth="3xl">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4A237]/10 flex items-center justify-center shrink-0">
              <Download size={20} className="text-[#D4A237]" />
            </div>
            <div>
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Download via Nxsha
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isTV
                  ? `Season ${effectiveSeason} · Episode ${effectiveEpisode}`
                  : "Direct file links"}
              </p>
            </div>
          </div>

          {/* TV season / episode picker */}
          {isTV && (
            <div className="flex items-center gap-2">
              <NumSelect
                label="S"
                value={pickedSeason}
                max={50}
                onChange={setPickedSeason}
              />
              <NumSelect
                label="E"
                value={pickedEpisode}
                max={300}
                onChange={setPickedEpisode}
              />
              <button
                onClick={() => setScrapeKey((k) => k + 1)}
                title="Reload links"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.08] text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
              >
                <RefreshCw size={13} />
                Load
              </button>
            </div>
          )}
        </div>

        {/* Status states */}
        {(phase === "loading" || phase === "solving") && (
          <StatusCard phase={phase} statusText={statusText} />
        )}

        {phase === "failed" && (
          <StateCard
            icon={<AlertCircle className="h-8 w-8 text-[#E05252]" />}
            title="Failed to load"
            body={error}
            action={
              <button
                onClick={() => setScrapeKey((k) => k + 1)}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            }
          />
        )}

        {phase === "no-links" && (
          <StateCard
            icon={<AlertCircle className="h-8 w-8 text-[#D4A237]" />}
            title="No links found"
            body={
              error ||
              "Nxsha returned no downloadable links. The title may not be available yet — try again later or pick another source."
            }
            action={
              <button
                onClick={() => setScrapeKey((k) => k + 1)}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            }
          />
        )}

        {/* Server accordions */}
        {phase === "links" && (
          <>
            <p className="text-xs uppercase tracking-[0.12em] text-faint mb-3">
              {organized.length} server{organized.length === 1 ? "" : "s"} ·{" "}
              {totalLinks} link{totalLinks === 1 ? "" : "s"}
            </p>
            <div className="space-y-2.5">
              {organized.map((server, idx) => (
                <ServerCard
                  key={server.name + idx}
                  server={server}
                  expanded={expanded[idx] ?? false}
                  onToggle={() =>
                    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }))
                  }
                  downloads={downloads}
                  onDownload={handleDownload}
                  onOpenExternal={(url) => {
                    void window.electronAPI?.app?.openExternal?.(url);
                  }}
                />
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between rounded-xl bg-[#0E0E11] border border-white/[0.06] px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Queued downloads appear in the manager with live progress.
              </p>
              <Link
                href="/downloads"
                className="shrink-0 ml-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#D4A237] hover:underline"
              >
                <Download size={13} />
                View Downloads
              </Link>
            </div>
          </>
        )}
      </PageShell>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function NumSelect({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
      <span className="text-[11px] font-bold text-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-transparent text-sm text-foreground outline-none [&>option]:bg-[#16161A]"
      >
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusCard({
  phase,
  statusText,
}: {
  phase: "loading" | "solving";
  statusText?: string;
}) {
  // API path streams human progress ("Fetched 12 sources · 2 servers");
  // show that instead of the captcha-scrape step list.
  if (statusText) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-10 text-center">
        <Loader2
          size={22}
          className="text-[#D4A237] animate-spin mx-auto mb-4"
        />
        <p className="text-sm text-muted-foreground">{statusText}</p>
        <p className="text-[11px] text-faint mt-2 tabular-nums">
          Talking to nxsha&apos;s own API — no browser needed
        </p>
      </div>
    );
  }
  const step = phase === "loading" ? 0 : 1;
  const steps = ["Loading nxsha page", "Solving CAPTCHA", "Extracting links"];
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-10">
      <div className="max-w-xs mx-auto space-y-4">
        {steps.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div key={label} className="flex items-center gap-3">
              {done ? (
                <CheckCircle2 size={18} className="text-[#3FB950]" />
              ) : active ? (
                <Loader2 size={18} className="text-[#D4A237] animate-spin" />
              ) : (
                <span className="w-[18px] h-[18px] rounded-full border border-[#333338]" />
              )}
              <span
                className={`text-sm ${
                  active
                    ? "text-foreground font-medium"
                    : done
                      ? "text-muted-foreground"
                      : "text-faint"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StateCard({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center mx-auto mb-5">
        {icon}
      </div>
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{body}</p>
      {action}
    </div>
  );
}

function ServerCard({
  server,
  expanded,
  onToggle,
  downloads,
  onDownload,
  onOpenExternal,
}: {
  server: ReturnType<typeof organizeServers>[number];
  expanded: boolean;
  onToggle: () => void;
  downloads: ReturnType<typeof useDownloadList>;
  onDownload: (link: ParsedLink) => void;
  onOpenExternal: (url: string) => void;
}) {
  const sorted = useMemo(() => sortParsedLinks(server.parsed), [server.parsed]);

  const audioGroups = useMemo(() => {
    const groups: Array<{ audioLabel: string; links: ParsedLink[] }> = [];
    let currentGroup: ParsedLink[] = [];
    let currentLabel = sorted[0]?.audioLabel || "";
    for (const link of sorted) {
      if (link.audioLabel !== currentLabel && currentGroup.length > 0) {
        groups.push({ audioLabel: currentLabel, links: [...currentGroup] });
        currentGroup = [];
        currentLabel = link.audioLabel;
      }
      currentGroup.push(link);
    }
    if (currentGroup.length > 0)
      groups.push({ audioLabel: currentLabel, links: currentGroup });
    return groups;
  }, [sorted]);

  const audioBadges = useMemo(() => {
    const set = new Set<string>();
    for (const l of sorted) if (l.audioLabel) set.add(l.audioLabel);
    return Array.from(set);
  }, [sorted]);

  return (
    <div className="rounded-xl overflow-hidden bg-[#0E0E11] border border-[#222226] hover:border-[#D4A237]/20 transition-all">
      {/* Accordion header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-3 min-w-0 flex-1 mr-3">
          <span className="w-8 h-8 rounded-lg bg-[#D4A237]/10 flex items-center justify-center shrink-0">
            <Server size={14} className="text-[#D4A237]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold truncate">
              {server.name}
            </span>
            <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {audioBadges.map((b) => (
                <span
                  key={b}
                  className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground bg-white/[0.05] rounded px-1.5 py-0.5"
                >
                  {b}
                </span>
              ))}
              <span className="text-[11px] text-faint">
                {sorted.length} link{sorted.length === 1 ? "" : "s"}
              </span>
            </span>
          </span>
        </span>
        {expanded ? (
          <ChevronUp size={18} className="text-faint shrink-0" />
        ) : (
          <ChevronDown size={18} className="text-faint shrink-0" />
        )}
      </button>

      {/* Expanded body — audio-grouped link rows */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/[0.04] pt-3">
          {audioGroups.map((group, gi) => (
            <div key={gi}>
              {group.audioLabel && (
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint mb-2">
                  {group.audioLabel}
                </p>
              )}
              <div className="space-y-1.5">
                {group.links.map((link) => (
                  <LinkRow
                    key={link.downloadUrl}
                    link={link}
                    downloads={downloads}
                    onDownload={() => onDownload(link)}
                    onOpenExternal={onOpenExternal}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkRow({
  link,
  downloads,
  onDownload,
  onOpenExternal,
}: {
  link: ParsedLink;
  downloads: ReturnType<typeof useDownloadList>;
  onDownload: () => void;
  onOpenExternal: (url: string) => void;
}) {
  // Match by exact URL — desktop tasks don't carry a quality field.
  const task = useMemo(
    () => downloads.find((t) => t.url === link.downloadUrl),
    [downloads, link.downloadUrl],
  );
  const isActive = task?.state === "active" || task?.state === "paused";
  const isDone = task?.state === "completed";
  const progress =
    task && task.totalBytes > 0
      ? Math.min(task.receivedBytes / task.totalBytes, 1)
      : task?.state === "completed"
        ? 1
        : 0;
  const color = qualityColor(link);
  const displayName =
    link.filename ||
    `${link.audioLabel || link.extras.join(" ") || link.server}${
      link.size ? ` · ${link.size}` : ""
    }`;
  const subtitle = link.filename ? "" : shortHost(link.downloadUrl);

  return (
    <div className="group flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      <span
        className="shrink-0 min-w-[52px] text-center rounded-lg px-2 py-1 text-[11px] font-extrabold tracking-wide"
        style={{ color, backgroundColor: `${color}18` }}
      >
        {QUALITY_DISPLAY[link.quality] ?? (link.quality || "—").toUpperCase()}
      </span>

      <div className="flex-1 min-w-0">
        {/* Line 1 — size + languages + extras */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {link.size ? (
            <span className="text-xs font-semibold text-foreground tabular-nums">
              {link.size}
            </span>
          ) : (
            <span className="text-xs text-faint">size unknown</span>
          )}
          {link.audioLabel && (
            <span className="text-[11px] font-semibold text-muted-foreground">
              {link.audioLabel}
            </span>
          )}
          {link.langs.map((l) => (
            <span
              key={l}
              className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground bg-white/[0.05] rounded px-1.5 py-0.5"
            >
              {l}
            </span>
          ))}
          {link.extras.slice(0, 4).map((e) => (
            <span
              key={e}
              className="text-[11px] text-faint border border-white/[0.07] rounded px-1.5 py-0.5"
            >
              {e}
            </span>
          ))}
          {link.mirrorCount > 1 && (
            <span
              title={`${link.mirrorCount} mirrors share this release`}
              className="text-[11px] text-[#D4A237]/80"
            >
              +{link.mirrorCount - 1} mirror{link.mirrorCount > 2 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Line 2 — filename or host */}
        <p
          className="text-[11px] text-faint truncate mt-0.5"
          title={subtitle ? link.downloadUrl : displayName}
        >
          {displayName}
          {subtitle && <span className="text-faint/70"> — {subtitle}</span>}
          {!link.isDirect && (
            <span className="ml-1.5 text-[#60A5FA]">gateway</span>
          )}
        </p>

        {isActive && progress > 0 && (
          <div className="mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress * 100}%`, backgroundColor: color }}
            />
          </div>
        )}
      </div>

      {isActive ? (
        <Loader2
          size={18}
          className="animate-spin shrink-0"
          style={{ color }}
        />
      ) : isDone ? (
        <CheckCircle2 size={18} className="text-[#3FB950] shrink-0" />
      ) : !link.isDirect ? (
        <button
          onClick={() => onOpenExternal(link.downloadUrl)}
          aria-label="Open in browser"
          title="Landing page — opens in your browser to finish the download"
          className="w-8 h-8 rounded-full bg-[#3B82F6]/15 hover:bg-[#3B82F6]/30 flex items-center justify-center shrink-0 transition-colors"
        >
          <ExternalLink size={14} className="text-[#60A5FA]" />
        </button>
      ) : (
        <button
          onClick={onDownload}
          aria-label={`Download ${link.quality || ""}`}
          title="Download"
          className="w-8 h-8 rounded-full bg-[#D4A237]/15 hover:bg-[#D4A237]/30 flex items-center justify-center shrink-0 transition-colors"
        >
          <Download size={15} className="text-[#D4A237]" />
        </button>
      )}
    </div>
  );
}

/** Compact host display for URL-only rows. */
function shortHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
