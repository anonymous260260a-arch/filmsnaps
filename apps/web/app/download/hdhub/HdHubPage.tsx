"use client";

/**
 * HDHub Download Page — web port of mobile's download/hdhub/[...id].tsx.
 *
 * HDHub is a JSON stream API keyed by IMDB id; /api/player/direct resolves
 * TMDB → IMDB, fetches it server-side (CORS-free) and returns every link
 * including the download-only entries the player deprioritises. We pass
 * `fallback=none` so the route's falix supplement stays out — this page
 * promises HDHub files only.
 *
 * Movies list all qualities at once. TV picks season/episode up front (same
 * NumSelect pattern as the Nxsha page) and refetches on change.
 *
 * Route: /download/hdhub?type=movie&id={tmdbId}
 *        /download/hdhub?type=tv&id={tmdbId}&season={s}&episode={e}
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileVideo,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Header } from "@/components/Header";
import { PageShell } from "@/components/PageShell";
import {
  isDownloadAvailable,
  startDownload,
  useDownloadList,
} from "@/lib/downloadStore";
import { isGatewayUrl } from "@/lib/nxshaLinks";
import { tmdbApi, apiUrl } from "@/lib/tmdb";
import { useSettings } from "@/hooks/useSettings";
import {
  buildDownloadFileName,
  describeDownloadFile,
  downloadMetaSegments,
  rankDownloadLinks,
  type DownloadFileDetails,
  type MetaTone,
  type StreamLink,
} from "@filmsnaps/shared";

/** Class per meta segment — gold quality, sky language, amber warnings. */
const META_TONE_CLASS: Record<MetaTone, string> = {
  quality: "text-[#D4A237] font-semibold",
  size: "font-mono tabular-nums text-faint font-semibold",
  language: "text-sky-300",
  info: "text-faint",
  cam: "text-[#F87171] font-semibold",
  warn: "text-[#F59E0B] font-semibold",
};

interface HdHubRow {
  link: StreamLink;
  details: DownloadFileDetails;
  gateway: boolean;
}

type RowState = "completed" | "active" | "idle";

export default function HdHubDownloadPage() {
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
  // Bumped by Retry to force a refetch without touching the pickers.
  const [retryKey, setRetryKey] = useState(0);

  const available = isDownloadAvailable();
  const downloads = useDownloadList();
  const { settings } = useSettings();

  const [title, setTitle] = useState("");
  const [links, setLinks] = useState<StreamLink[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const effectiveSeason = pickedSeason || 1;
  const effectiveEpisode = pickedEpisode || 1;

  // ── Title (for the header + generated filenames) ──
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const details = isTV
      ? tmdbApi.getTVDetails(id)
      : tmdbApi.getMovieDetails(id);
    details
      .then((d: { title?: string; name?: string }) => {
        if (alive) setTitle(d?.title || d?.name || "");
      })
      .catch(() => {
        // Filename falls back to a generic scheme below — not fatal.
      });
    return () => {
      alive = false;
    };
  }, [id, isTV]);

  // ── HDHub links via the shared direct proxy ──
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError("");
    setLinks(null);

    const qs = new URLSearchParams({ id, fallback: "none" });
    if (isTV) {
      qs.set("season", String(effectiveSeason));
      qs.set("episode", String(effectiveEpisode));
    }

    fetch(apiUrl(`/api/player/direct?${qs.toString()}`))
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          links?: StreamLink[];
          error?: string;
        } | null;
        if (!res.ok || !body) {
          throw new Error(body?.error || `HDHub lookup failed (${res.status})`);
        }
        if (!alive) return;
        setLinks(body.links ?? []);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [id, isTV, effectiveSeason, effectiveEpisode, retryKey]);

  // ── Episode title for filenames — gated on `links`, so TMDB is never
  // called before there is anything to name. ──
  const [episodeName, setEpisodeName] = useState("");
  useEffect(() => {
    if (!isTV || !id || !links) return;
    let alive = true;
    tmdbApi
      .getSeason(id, effectiveSeason)
      .then(
        (data: { episodes?: { episode_number?: number; name?: string }[] }) => {
          if (!alive) return;
          const ep = data?.episodes?.find(
            (e) => e.episode_number === effectiveEpisode,
          );
          setEpisodeName(ep?.name || "");
        },
      )
      .catch(() => {
        // Cleaner falls back to the episode run — not fatal.
      });
    return () => {
      alive = false;
    };
  }, [isTV, id, links, effectiveSeason, effectiveEpisode]);

  // Ranked by the shared download chain: the user's preferred audio language
  // first, then language → quality → audio format → clean print → size.
  const rows: HdHubRow[] = useMemo(() => {
    const ranked = rankDownloadLinks(links ?? [], {
      preferredLanguage: settings.preferredAudioLanguage,
    });
    const nameCtx = {
      title: title || undefined,
      episodeName: episodeName || undefined,
    };
    return ranked.map((link) => ({
      link,
      details: describeDownloadFile(link, nameCtx),
      gateway: isGatewayUrl(link.url),
    }));
  }, [links, settings.preferredAudioLanguage, title, episodeName]);

  const directRows = rows.filter((r) => !r.gateway);
  const externalRows = rows.filter((r) => r.gateway);

  const getRowState = useCallback(
    (link: StreamLink): RowState => {
      const task = downloads.find((t) => t.url === link.url);
      if (!task) return "idle";
      if (task.state === "completed") return "completed";
      if (task.state === "active" || task.state === "paused") return "active";
      return "idle";
    },
    [downloads],
  );

  /** Desktop → native download manager. Web → the browser saves the file. */
  const downloadFile = useCallback(
    (row: HdHubRow) => {
      const filename = buildDownloadFileName({
        details: row.details,
        title: title || "HDHub",
        mediaType: type,
        season: effectiveSeason,
        episode: effectiveEpisode,
      });

      if (available) {
        startDownload({
          url: row.link.url,
          title: filename,
          tmdbId: id,
          mediaType: type,
          season: isTV ? effectiveSeason : undefined,
          episode: isTV ? effectiveEpisode : undefined,
        });
      } else {
        window.open(row.link.url, "_blank");
      }
    },
    [available, id, title, type, isTV, effectiveSeason, effectiveEpisode],
  );

  const openInBrowser = (url: string) => {
    const ext = window.electronAPI?.app?.openExternal;
    if (ext) ext(url);
    else window.open(url, "_blank");
  };

  const retry = () => setRetryKey((k) => k + 1);

  // ── Missing id ──
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
              <FileVideo size={20} className="text-[#D4A237]" />
            </div>
            <div>
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Download via HDHub
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {title ? `${title} · ` : ""}
                {isTV
                  ? `Season ${effectiveSeason} · Episode ${effectiveEpisode}`
                  : "Direct CDN files"}
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
                onClick={retry}
                title="Reload links"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.08] text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
              >
                <RefreshCw size={13} />
                Load
              </button>
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-10 text-center">
            <Loader2
              size={22}
              className="text-[#D4A237] animate-spin mx-auto mb-4"
            />
            <p className="text-sm text-muted-foreground">
              Resolving HDHub links…
            </p>
            <p className="text-[11px] text-faint mt-2">
              TMDB id → IMDB id → HDHub API
            </p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <StateCard
            icon={<AlertCircle className="h-8 w-8 text-[#E05252]" />}
            title="Failed to load"
            body={error}
            action={
              <button
                onClick={retry}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            }
          />
        )}

        {/* Empty */}
        {!loading && !error && rows.length === 0 && (
          <StateCard
            icon={<AlertCircle className="h-8 w-8 text-[#D4A237]" />}
            title="No files found"
            body={
              isTV
                ? `HDHub has no download links for Season ${effectiveSeason}, Episode ${effectiveEpisode}. Try another episode.`
                : "HDHub has no download links for this title yet."
            }
            action={
              <button
                onClick={retry}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            }
          />
        )}

        {/* Direct files */}
        {!loading && !error && directRows.length > 0 && (
          <>
            <p className="text-xs uppercase tracking-[0.12em] text-faint mb-3">
              {directRows.length} download{directRows.length === 1 ? "" : "s"} ·
              HDHub
            </p>
            <div className="space-y-2.5">
              {directRows.map((row, idx) => {
                const state = getRowState(row.link);
                const task = downloads.find((t) => t.url === row.link.url);
                const progress =
                  task && task.totalBytes > 0
                    ? task.receivedBytes / task.totalBytes
                    : 0;
                return (
                  <FileRowView
                    key={`${row.link.url}-${idx}`}
                    row={row}
                    progress={state === "active" ? progress : undefined}
                    action={
                      <button
                        onClick={() => downloadFile(row)}
                        disabled={state === "active"}
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all disabled:opacity-60 ${
                          state === "completed"
                            ? "bg-[#3FB950]/12 text-[#3FB950]"
                            : "bg-[#D4A237] text-[#070708] hover:bg-[#B88B2A]"
                        }`}
                      >
                        {state === "completed" ? (
                          <CheckCircle2 size={14} />
                        ) : state === "active" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Download size={14} />
                        )}
                        {state === "completed"
                          ? "Saved"
                          : state === "active"
                            ? `${Math.round(progress * 100)}%`
                            : "Download"}
                      </button>
                    }
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Gateway / landing pages — only openable externally */}
        {!loading && !error && externalRows.length > 0 && (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.12em] text-faint mb-3">
              Open in browser · {externalRows.length} link
              {externalRows.length === 1 ? "" : "s"}
            </p>
            <p className="text-[12px] text-muted-foreground mb-3">
              These hosts serve a web page instead of a direct file, so they
              can&apos;t be downloaded in-app.
            </p>
            <div className="space-y-2.5">
              {externalRows.map((row, idx) => (
                <FileRowView
                  key={`${row.link.url}-${idx}`}
                  row={row}
                  action={
                    <button
                      onClick={() => openInBrowser(row.link.url)}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#D4A237]/40 bg-[#D4A237]/[0.08] px-3 py-2 text-xs font-bold text-[#D4A237] hover:bg-[#D4A237]/15 transition-all"
                    >
                      <ExternalLink size={14} />
                      Open
                    </button>
                  }
                />
              ))}
            </div>
          </div>
        )}

        {directRows.length > 0 && (
          <div className="mt-6 flex items-center justify-between rounded-xl bg-[#0E0E11] border border-white/[0.06] px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {available
                ? "Queued downloads appear in the manager with live progress."
                : "Downloading needs FilmSnaps Desktop — links open in your browser instead."}
            </p>
            <Link
              href="/downloads"
              className="shrink-0 ml-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#D4A237] hover:underline"
            >
              <Download size={13} />
              View Downloads
            </Link>
          </div>
        )}
      </PageShell>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

/**
 * One file row — two lines of text and a button, nothing more.
 *   1. the FULL file name (wraps; full text on hover)
 *   2. one quiet meta line: quality · size · languages · audio (+ flags)
 * The release name already carries codec/container/source, so those are not
 * repeated — that repetition is what made the first pass feel noisy.
 */
function FileRowView({
  row,
  action,
  progress,
}: {
  row: HdHubRow;
  action: React.ReactNode;
  progress?: number;
}) {
  const segments = downloadMetaSegments(row.details);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#0E0E11] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p
          title={row.details.name}
          className="text-[13px] font-medium text-foreground/90 break-words leading-snug"
        >
          {row.details.name}
        </p>

        <p className="mt-1 text-[11px] leading-relaxed break-words">
          {segments.map((seg, i) => (
            <span key={`${seg.tone}-${seg.label}`}>
              {i > 0 && <span className="text-faint">{" · "}</span>}
              <span className={META_TONE_CLASS[seg.tone]}>{seg.label}</span>
            </span>
          ))}
        </p>

        {progress !== undefined && (
          <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full bg-[#D4A237] transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>

      {action}
    </div>
  );
}

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
      <p className="text-sm text-muted-foreground max-w-md mx-auto break-words">
        {body}
      </p>
      {action}
    </div>
  );
}
