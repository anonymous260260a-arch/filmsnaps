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
 * Movies list all qualities at once. TV picks season (pill tabs, same
 * language as the Falix page) + episode up front and refetches on change.
 *
 * Presentation mirrors the Falix page's hero system (blurred backdrop,
 * poster + meta chips, gold best-match CTA, display-font section headers)
 * so all three download routes read as one product.
 *
 * Route: /download/hdhub?type=movie&id={tmdbId}
 *        /download/hdhub?type=tv&id={tmdbId}&season={s}&episode={e}
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileVideo,
  Loader2,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import { Header } from "@/components/Header";
import { PageShell } from "@/components/PageShell";
import {
  isDownloadAvailable,
  startDownload,
  useDownloadList,
} from "@/lib/downloadStore";
import { isGatewayUrl } from "@/lib/nxshaLinks";
import { tmdbApi, apiUrl, apiClientHeaders, getImageUrl } from "@/lib/tmdb";
import { useSettings } from "@/hooks/useSettings";
import {
  buildDownloadFileName,
  describeDownloadFile,
  downloadMetaSegments,
  passesDownloadFilter,
  rankDownloadLinks,
  type DownloadFileDetails,
  type DownloadRankOptions,
  type MetaTone,
  type StreamLink,
} from "@filmsnaps/shared";

const QUALITY_OPTIONS: { label: string; value: string }[] = [
  { label: "All qualities", value: "" },
  { label: "4K", value: "4K" },
  { label: "1080p", value: "1080p" },
  { label: "720p", value: "720p" },
  { label: "480p", value: "480p" },
];

const SIZE_OPTIONS: { label: string; value: string }[] = [
  { label: "Any size", value: "" },
  { label: "≤ 1 GB", value: "1gb" },
  { label: "1–4 GB", value: "4gb" },
  { label: "4–8 GB", value: "8gb" },
  { label: "> 8 GB", value: "gt8gb" },
];

const LANGUAGE_OPTIONS: { label: string; value: string }[] = [
  { label: "Any language", value: "" },
  { label: "Multi / Dual", value: "multi" },
  { label: "Hindi", value: "hindi" },
  { label: "English", value: "english" },
];

/** Class per meta segment — gold quality, sky language, amber warnings. */
const META_TONE_CLASS: Record<MetaTone, string> = {
  quality: "text-primary font-semibold",
  size: "font-mono tabular-nums text-faint font-semibold",
  language: "text-sky-300",
  info: "text-faint",
  cam: "text-destructive font-semibold",
  warn: "text-primary font-semibold",
};

interface HdHubRow {
  link: StreamLink;
  details: DownloadFileDetails;
  gateway: boolean;
}

type RowState = "completed" | "active" | "idle";

/** Title context for the hero — everything TMDB details gives us in one shot. */
interface TitleMeta {
  title: string;
  year: string;
  runtime: number | null;
  rating: number | null;
  genres: string[];
  posterPath: string | null;
  backdropPath: string | null;
}

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
  const [retryKey, setRetryKey] = useState(0);

  const available = isDownloadAvailable();
  const downloads = useDownloadList();
  const { settings } = useSettings();

  /** Hero context — null until the TMDB details call resolves. */
  const [meta, setMeta] = useState<TitleMeta | null>(null);
  const title = meta?.title ?? "";
  /** Real season bound from TMDB — 0 until the details call resolves. */
  const [seasonCount, setSeasonCount] = useState(0);
  /** Real episode count for `effectiveSeason` — 0 until that season loads. */
  const [episodeCount, setEpisodeCount] = useState(0);
  const [links, setLinks] = useState<StreamLink[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const effectiveSeason = pickedSeason || 1;
  const effectiveEpisode = pickedEpisode || 1;

  const [qualityFilter, setQualityFilter] = useState<string>(
    searchParams.get("q") ?? "",
  );
  const [sizeFilter, setSizeFilter] = useState<string>(
    searchParams.get("sz") ?? "",
  );
  const [languageFilter, setLanguageFilter] = useState<string>(
    searchParams.get("lg") ?? "",
  );

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    if (qualityFilter) next.set("q", qualityFilter);
    else next.delete("q");
    if (sizeFilter) next.set("sz", sizeFilter);
    else next.delete("sz");
    if (languageFilter) next.set("lg", languageFilter);
    else next.delete("lg");
    const changed = next.toString();
    if (changed !== window.location.search.slice(1)) {
      window.history.replaceState(null, "", "/download/hdhub?" + changed);
    }
  }, [qualityFilter, sizeFilter, languageFilter]);

  // ── Hero meta (poster/backdrop/year/genres) — also the source of the
  // season picker's real bound. ──
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const details = isTV
      ? tmdbApi.getTVDetails(id)
      : tmdbApi.getMovieDetails(id);
    details
      .then(
        (d: {
          title?: string;
          name?: string;
          release_date?: string;
          first_air_date?: string;
          runtime?: number;
          vote_average?: number;
          genres?: { name?: string }[];
          poster_path?: string | null;
          backdrop_path?: string | null;
          number_of_seasons?: number;
          seasons?: { season_number?: number }[];
        }) => {
          if (!alive) return;
          setMeta({
            title: d?.title || d?.name || "",
            year: (d?.release_date || d?.first_air_date || "").slice(0, 4),
            runtime: d?.runtime ?? null,
            rating:
              typeof d?.vote_average === "number" && d.vote_average > 0
                ? d.vote_average
                : null,
            genres: (d?.genres ?? []).map((g) => g.name ?? "").filter(Boolean),
            posterPath: d?.poster_path ?? null,
            backdropPath: d?.backdrop_path ?? null,
          });
          if (!isTV) return;
          // Prefer the highest season TMDB actually lists (survives gaps
          // in numbering); fall back to number_of_seasons.
          const nums = (d?.seasons ?? [])
            .map((s) => s.season_number ?? 0)
            .filter((n) => n > 0);
          const max =
            nums.length > 0 ? Math.max(...nums) : (d?.number_of_seasons ?? 0);
          if (max > 0) {
            setSeasonCount(max);
            // A season from the URL/share link can exceed the real count.
            setPickedSeason((s) => (s > max ? max : s));
          }
        },
      )
      .catch(() => {
        // Hero falls back to a generic header, filenames to a generic
        // scheme below — not fatal.
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

    fetch(apiUrl(`/api/player/direct?${qs.toString()}`), {
      headers: apiClientHeaders(),
    })
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

  // ── Season metadata: the episode picker's real bound + the episode name
  // for filenames. Deliberately NOT gated on `links` — the picker must show
  // the true episode count even while HDHub is loading (or after it fails). ──
  const [episodeName, setEpisodeName] = useState("");
  useEffect(() => {
    if (!isTV || !id) return;
    let alive = true;
    tmdbApi
      .getSeason(id, effectiveSeason)
      .then(
        (data: {
          episode_count?: number;
          episodes?: { episode_number?: number; name?: string }[];
        }) => {
          if (!alive) return;
          const eps = data?.episodes ?? [];
          const count = eps.length || data?.episode_count || 0;
          if (count > 0) {
            setEpisodeCount(count);
            // A picked episode (URL, or a long previous season) can exceed
            // this season's real count — snap it back into range.
            setPickedEpisode((e) => (e > count ? count : e));
          }
          const ep = eps.find((e) => e.episode_number === effectiveEpisode);
          setEpisodeName(ep?.name || "");
        },
      )
      .catch(() => {
        // Cleaner falls back to the episode run — not fatal.
      });
    return () => {
      alive = false;
    };
  }, [isTV, id, effectiveSeason, effectiveEpisode]);

  // Ranked by the shared download chain: the user's preferred audio language
  // first, then language → quality → audio format → clean print → size.
  const filterState = useMemo(
    () => ({
      quality: qualityFilter,
      size: sizeFilter,
      language: languageFilter,
    }),
    [qualityFilter, sizeFilter, languageFilter],
  );

  const rows: HdHubRow[] = useMemo(() => {
    // Ask the ranker to attach filter dimensions onto each link's _meta so the
    // filter UI can use the same derived data the row renders. attachDimensions
    // only mutates _meta — the ranking itself is unchanged.
    const ranked = rankDownloadLinks(links ?? [], {
      preferredLanguage:
        settings.preferredAudioLanguage !== "auto"
          ? settings.preferredAudioLanguage
          : undefined,
      attachDimensions: true,
    } as DownloadRankOptions);
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

  const filteredRows = rows.filter((r) =>
    passesDownloadFilter(r.link, filterState),
  );
  const directRows = filteredRows.filter((r) => !r.gateway);
  const externalRows = filteredRows.filter((r) => r.gateway);
  const activeFilterCount =
    (qualityFilter ? 1 : 0) + (sizeFilter ? 1 : 0) + (languageFilter ? 1 : 0);

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

  const clearFilters = () => {
    setQualityFilter("");
    setSizeFilter("");
    setLanguageFilter("");
  };

  const runtimeLabel =
    meta?.runtime != null && meta.runtime > 0
      ? meta.runtime >= 60
        ? `${Math.floor(meta.runtime / 60)}h ${meta.runtime % 60}m`
        : `${meta.runtime}m`
      : null;

  // ── Missing id ──
  if (!id) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <PageShell maxWidth="2xl" className="text-center">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Download unavailable</h1>
          <Link href="/" className="text-sm text-primary hover:underline">
            Go home
          </Link>
        </PageShell>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      {/* Blurred backdrop hero — same treatment as the Falix page */}
      {meta?.backdropPath && (
        <div className="absolute inset-x-0 top-0 h-[420px] overflow-hidden pointer-events-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getImageUrl(meta.backdropPath, "w1280") ?? ""}
            alt=""
            className="w-full h-full object-cover blur-2xl scale-110 opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
        </div>
      )}

      <Header />

      <PageShell variant="hero" maxWidth="3xl" className="relative">
        {/* ═══ Hero: poster + title + meta chips (+ TV pickers) ═══ */}
        <div className="flex items-start gap-5 mb-8 flex-wrap">
          {meta?.posterPath ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={getImageUrl(meta.posterPath, "w342") ?? ""}
              alt={meta.title}
              className="w-[115px] h-[172px] rounded-xl object-cover ring-1 ring-white/10 shadow-xl shadow-black/40 shrink-0"
            />
          ) : (
            <div className="w-[115px] h-[172px] rounded-xl skeleton shrink-0" />
          )}

          <div className="flex-1 min-w-[240px] pt-1">
            {meta ? (
              <>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-2.5 py-1 text-[11px] font-bold text-primary">
                    <FileVideo size={11} />
                    HDHub
                  </span>
                  <span className="text-[11px] text-faint">
                    {isTV
                      ? `Season ${effectiveSeason} · Episode ${effectiveEpisode}`
                      : "Direct CDN files"}
                  </span>
                </div>

                <h1
                  className="text-2xl sm:text-3xl font-bold leading-tight tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {meta.title || "Download via HDHub"}
                </h1>

                <div className="flex items-center gap-2 mt-3 flex-wrap text-xs">
                  {meta.rating != null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1 font-bold text-primary">
                      <Star size={11} fill="currentColor" />
                      {meta.rating.toFixed(1)}
                    </span>
                  )}
                  {meta.year && <span className="text-faint">{meta.year}</span>}
                  {runtimeLabel && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="text-faint">{runtimeLabel}</span>
                    </>
                  )}
                </div>

                {meta.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {meta.genres.slice(0, 4).map((g) => (
                      <span
                        key={g}
                        className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-foreground/90"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                {isTV && (
                  <div className="mt-4">
                    {/* Season pills — same tab language as the Falix page */}
                    <div className="flex gap-2 overflow-x-auto pb-1 mb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {(seasonCount > 0
                        ? Array.from({ length: seasonCount }, (_, i) => i + 1)
                        : [effectiveSeason]
                      ).map((n) => (
                        <button
                          key={n}
                          onClick={() => setPickedSeason(n)}
                          className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-bold transition-all ${
                            pickedSeason === n
                              ? "bg-primary text-background"
                              : "bg-white/[0.04] text-foreground/90 border border-white/[0.06] hover:bg-white/[0.07]"
                          }`}
                        >
                          Season {n}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <EpisodeSelect
                        value={pickedEpisode}
                        max={episodeCount || Math.max(pickedEpisode, 1)}
                        onChange={setPickedEpisode}
                      />
                      <button
                        onClick={retry}
                        title="Reload links"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.10] bg-white/[0.04] text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.08] transition-all"
                      >
                        <RefreshCw size={13} />
                        Reload
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="pt-1 space-y-3">
                <div className="skeleton h-6 w-28 rounded-full" />
                <div className="skeleton h-8 w-64 rounded" />
                <div className="skeleton h-4 w-44 rounded" />
              </div>
            )}
          </div>
        </div>

        {/* ═══ Filter toolbar — the ONE filter row (quality/size/language) ═══ */}
        {!loading && !error && rows.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-6 pb-5 border-b border-white/[0.06]">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint mr-1">
              Filters
            </span>
            <FilterSelect
              label="Quality"
              options={QUALITY_OPTIONS}
              value={qualityFilter}
              onChange={(v) => setQualityFilter(v ?? "")}
            />
            <FilterSelect
              label="Size"
              options={SIZE_OPTIONS}
              value={sizeFilter}
              onChange={(v) => setSizeFilter(v ?? "")}
            />
            <FilterSelect
              label="Language"
              options={LANGUAGE_OPTIONS}
              value={languageFilter}
              onChange={(v) => setLanguageFilter(v ?? "")}
            />
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
              >
                <X size={11} />
                Clear
              </button>
            )}
            <span className="ml-auto text-[11px] text-faint tabular-nums">
              {filteredRows.length} of {rows.length} files
            </span>
          </div>
        )}

        {/* Loading — skeleton rows in the shape of the list */}
        {loading && (
          <div>
            <p className="flex items-center gap-2 text-xs text-faint mb-3">
              <Loader2 size={12} className="animate-spin" />
              Resolving HDHub links — TMDB id → IMDB id → HDHub API
            </p>
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/[0.06] bg-surface px-4 py-4"
                >
                  <div className="skeleton h-4 w-3/4 rounded mb-2.5" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <StateCard
            icon={<AlertCircle className="h-8 w-8 text-destructive" />}
            title="Failed to load"
            body={error}
            action={
              <button
                onClick={retry}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-dim transition-all"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            }
          />
        )}

        {/* Empty (after filters) */}
        {!loading &&
          !error &&
          filteredRows.length === 0 &&
          rows.length > 0 &&
          activeFilterCount > 0 && (
            <StateCard
              icon={<AlertCircle className="h-8 w-8 text-primary" />}
              title="No files match your filters"
              body={`None of the ${rows.length} files match the selected quality, size and language. Clear the filters to see everything.`}
              action={
                <button
                  onClick={clearFilters}
                  className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-dim transition-all"
                >
                  Clear filters
                </button>
              }
            />
          )}

        {/* Direct files */}
        {!loading && !error && directRows.length > 0 && (
          <section className="mb-8">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2
                className="text-base font-bold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Direct Downloads
              </h2>
              <span className="text-xs text-faint tabular-nums shrink-0">
                {directRows.length} file{directRows.length === 1 ? "" : "s"}
              </span>
            </div>
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
                            ? "bg-success/15 text-success"
                            : "bg-primary text-background hover:bg-primary-dim"
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
          </section>
        )}

        {/* Gateway / landing pages — only openable externally */}
        {!loading && !error && externalRows.length > 0 && (
          <section className="mb-8">
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <h2
                className="text-base font-bold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Open in Browser
              </h2>
              <span className="text-xs text-faint tabular-nums shrink-0">
                {externalRows.length} link{externalRows.length === 1 ? "" : "s"}
              </span>
            </div>
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
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/[0.08] px-3 py-2 text-xs font-bold text-primary hover:bg-primary/15 transition-all"
                    >
                      <ExternalLink size={14} />
                      Open
                    </button>
                  }
                />
              ))}
            </div>
          </section>
        )}

        {directRows.length > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-surface border border-white/[0.06] px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {available
                ? "Queued downloads appear in the manager with live progress."
                : "Downloading needs FilmSnaps Desktop — links open in your browser instead."}
            </p>
            <Link
              href="/downloads"
              className="shrink-0 ml-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
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
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-surface px-4 py-3.5 hover:border-white/[0.14] transition-colors">
      <div className="min-w-0 flex-1">
        <p
          title={row.details.name}
          className="text-[13px] font-medium text-foreground/90 break-words leading-snug"
        >
          {row.details.name}
        </p>

        <p className="mt-1.5 text-[11px] leading-relaxed break-words">
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
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>

      {action}
    </div>
  );
}

function EpisodeSelect({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  // A URL-seeded pick can exceed the real count for one render (before the
  // clamp effect lands) — clamp for display so <select> always has a match.
  const clamped = Math.min(Math.max(value || 1, 1), Math.max(max, 1));
  return (
    <label className="relative inline-flex items-center rounded-xl border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.07] transition-colors">
      <span className="pl-3 text-[11px] font-bold text-faint shrink-0">
        Episode
      </span>
      <select
        value={clamped}
        onChange={(e) => onChange(Number(e.target.value))}
        className="appearance-none bg-transparent py-2 pl-2 pr-8 text-[13px] font-semibold text-foreground outline-none [&>option]:bg-elevated"
      >
        {Array.from({ length: Math.max(max, 1) }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="pointer-events-none absolute right-2.5 text-muted-foreground"
      />
    </label>
  );
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string | undefined) => void;
}) {
  const active = value;
  return (
    <label
      className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 transition-colors ${
        active
          ? "border-primary/40 bg-primary/[0.08]"
          : "border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.07]"
      }`}
    >
      <span className="text-[11px] font-bold text-faint shrink-0">{label}</span>
      <select
        value={active}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="bg-transparent text-[13px] font-semibold text-foreground outline-none [&>option]:bg-elevated"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {active && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
          }}
          className="shrink-0 text-[11px] leading-none text-faint hover:text-foreground transition-colors"
          title={`Clear ${label} filter`}
        >
          ×
        </button>
      )}
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
    <div className="rounded-xl border border-white/[0.06] bg-surface px-6 py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center mx-auto mb-5">
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
