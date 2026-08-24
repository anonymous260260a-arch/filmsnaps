"use client";

/**
 * Falix Download Page — desktop port of mobile's download/falix/[...id].tsx.
 *
 * Falix is a plain REST API (HEVC telegram files); detail lookups are proxied
 * through main (`falix:detail`) to bypass CORS. Lookup chain: TMDB id first,
 * then the title's IMDB number via TMDB external ids (falix keys some entries
 * by IMDB), then the not-found card. Movies list direct quality options; TV
 * gets season tabs, expandable episodes and a bulk "Download All" panel with
 * a quality-tier selector (lowest / medium / highest).
 *
 * Route: /download/falix/movie/{tmdbId} · /download/falix/tv/{tmdbId}
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  FolderOpen,
  Layers,
  Loader2,
  MinusCircle,
  Star,
} from "lucide-react";
import { Header } from "@/components/Header";
import { PageShell } from "@/components/PageShell";
import {
  isDownloadAvailable,
  startDownload,
  useDownloadList,
} from "@/lib/downloadStore";
import { formatBytes } from "@/lib/format";
import { tmdbApi } from "@/lib/tmdb";

// ── API ──

const FALIX_API_BASE = "https://download-falix-falixmovies-backend-hf.hf.space";

interface FalixTelegramFile {
  quality: string;
  id: string;
  name: string;
  size: string;
}

interface FalixMovieData {
  tmdb_id: number;
  title: string;
  genres: string[];
  description: string;
  rating: number;
  release_year: number;
  poster: string;
  backdrop: string;
  media_type: "movie" | "tv";
  runtime: number;
  languages: string[];
  rip: string;
  telegram: FalixTelegramFile[];
  type: "movie";
}

interface FalixEpisode {
  episode_number: number;
  title: string;
  episode_backdrop: string;
  telegram: FalixTelegramFile[];
}

interface FalixTVData {
  tmdb_id: number;
  title: string;
  genres: string[];
  description: string;
  rating: number;
  release_year: number;
  poster: string;
  backdrop: string;
  media_type: "movie" | "tv";
  status: string;
  languages: string[];
  rip: string;
  seasons: Array<{
    season_number: number;
    episodes: FalixEpisode[];
  }>;
  type: "tv";
}

type FalixData = FalixMovieData | FalixTVData;

const buildDownloadUrl = (fileId: string, fileName: string): string =>
  `${FALIX_API_BASE}/dl/${fileId}/${encodeURIComponent(fileName)}`;

// ── Quality helpers (ported) ──

const QUALITY_ORDER: Record<string, number> = {
  "4k": 1,
  "2160p": 1,
  "1080p": 2,
  "720p": 3,
  "480p": 4,
  "360p": 5,
};

const sortByQuality = (a: FalixTelegramFile, b: FalixTelegramFile) => {
  const aq = QUALITY_ORDER[a.quality.toLowerCase()] ?? 99;
  const bq = QUALITY_ORDER[b.quality.toLowerCase()] ?? 99;
  return aq - bq;
};

/** "1.2 GB" → bytes (0 when unparseable). */
const parseSizeToBytes = (sizeStr: string): number => {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return value * (multipliers[unit] || 0);
};

// ── Language markers ──
// Falix telegram filenames embed audio-language tags ("Multi", "Hindi",
// "English", …). Users pick files BY language, so we surface them as chips
// instead of leaving them buried in a truncated release name. The list is
// deliberately exhaustive — every tag found in a name is shown, uncapped.
// Compound audio tags (DualAudio/MultiAudio) are matched as whole words so
// they don't also emit their "Dual"/"Multi" prefix chips.

const LANGUAGE_TAGS = [
  // Aggregators & audio-layout tags (priority order)
  "Multi",
  "MultiAudio",
  "Dual",
  "DualAudio",
  "Dubbed",
  // Indian subcontinent
  "Hindi",
  "English",
  "Urdu",
  "Punjabi",
  "Panjabi",
  "Marathi",
  "Gujarati",
  "Bengali",
  "Odia",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Tulu",
  "Bhojpuri",
  "Rajasthani",
  "Haryanvi",
  "Assamese",
  "Nepali",
  "Sinhala",
  // East & Southeast Asia
  "Japanese",
  "Korean",
  "Mandarin",
  "Cantonese",
  "Chinese",
  "Thai",
  "Vietnamese",
  "Indonesian",
  "Malay",
  "Filipino",
  "Tagalog",
  "Burmese",
  "Khmer",
  "Lao",
  // Middle East & Central Asia
  "Arabic",
  "Persian",
  "Farsi",
  "Turkish",
  "Kurdish",
  "Hebrew",
  "Georgian",
  "Armenian",
  "Azerbaijani",
  "Kazakh",
  "Uzbek",
  // Europe
  "Spanish",
  "French",
  "German",
  "Italian",
  "Dutch",
  "Portuguese",
  "Russian",
  "Ukrainian",
  "Belarusian",
  "Polish",
  "Czech",
  "Slovak",
  "Hungarian",
  "Romanian",
  "Bulgarian",
  "Serbian",
  "Croatian",
  "Bosnian",
  "Slovenian",
  "Albanian",
  "Macedonian",
  "Greek",
  "Lithuanian",
  "Latvian",
  "Estonian",
  "Danish",
  "Swedish",
  "Norwegian",
  "Finnish",
  "Icelandic",
  "Irish",
  "Welsh",
  "Catalan",
  "Basque",
  "Galician",
  // Africa & others
  "Swahili",
  "Afrikaans",
  "Zulu",
  "Amharic",
  "Hausa",
  "Yoruba",
  "Somali",
  "Mongolian",
];

/** Word-boundary scan of a release name for known language tags.
 * Leading separator: start / . / space / _ / - ; trailing additionally
 * allows digits so channel notations like "Hindi2.0" still match. */
const extractLanguages = (name: string): string[] => {
  const lower = name.toLowerCase();
  const found: string[] = [];
  for (const lang of LANGUAGE_TAGS) {
    if (
      new RegExp(`(?:^|[.\\s_-])${lang.toLowerCase()}(?:$|[.\\s_\\-\\d])`).test(
        lower,
      )
    ) {
      found.push(lang);
    }
  }
  return found;
};

type QualityTier = "low" | "mid" | "high";

const TIER_META: Record<
  QualityTier,
  { label: string; desc: string; icon: React.ReactNode }
> = {
  low: {
    label: "Lowest",
    desc: "Smallest file size",
    icon: <ArrowDownCircle size={20} />,
  },
  mid: {
    label: "Medium",
    desc: "Balanced quality & size",
    icon: <MinusCircle size={20} />,
  },
  high: {
    label: "Highest",
    desc: "Best available quality",
    icon: <ArrowUpCircle size={20} />,
  },
};

function getFileByTier(
  sortedFiles: FalixTelegramFile[],
  tier: QualityTier,
): FalixTelegramFile | null {
  if (sortedFiles.length === 0) return null;
  if (tier === "low") return sortedFiles[sortedFiles.length - 1];
  if (tier === "high") return sortedFiles[0];
  return sortedFiles[Math.floor(sortedFiles.length / 2)];
}

export default function FalixDownloadPage() {
  const params = useParams<{ id: string[] }>();
  const segs = useMemo(() => params?.id ?? [], [params]);
  const type = segs[0] === "tv" ? "tv" : segs[0] === "movie" ? "movie" : "";
  const id = segs[1] ?? "";

  const available = isDownloadAvailable();

  const [data, setData] = useState<FalixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [expandedEpisodes, setExpandedEpisodes] = useState<
    Record<number, boolean>
  >({});
  const [bulkQualityTier, setBulkQualityTier] = useState<QualityTier>("mid");
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const downloads = useDownloadList();

  // ── About description: clamped to 3 lines with a See more/less toggle ──
  // The button only renders when the text actually overflows the clamp.
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [descOverflows, setDescOverflows] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setShowFullDesc(false); // new title → re-collapse
    setDescOverflows(false);
    const el = descRef.current;
    if (!el) return;
    setDescOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [data?.description]);

  // ── Fetch detail through the main-process proxy ──
  // Lookup chain: try the URL's TMDB id first; on a clean 404 resolve the
  // title's IMDB id via TMDB and retry (falix keys some catalog entries by
  // their IMDB number — e.g. Shawshank lives at /api/id/111161, not 278).
  // Only when both miss does the not-found state render.
  useEffect(() => {
    const api = window.electronAPI?.falix;
    if (!available || !id || !type || !api) {
      if (!id) return;
      // Desktop runtime without the falix bridge (preloaded page context).
      if (available) {
        setError("Downloads backend not ready — reload the window.");
      }
      return;
    }
    let alive = true;

    const apply = (d: FalixData) => {
      setData(d);
      if (d?.type === "tv" && d.seasons?.length) {
        setSelectedSeason(d.seasons[0].season_number);
      }
    };
    const errMsg = (e: unknown) =>
      e instanceof Error ? e.message : String(e ?? "Fetch failed");
    const isNotFound = (e: unknown) => /\b404\b|not found/i.test(errMsg(e));

    void (async () => {
      setLoading(true);
      setError("");
      try {
        // Attempt 1: TMDB id.
        apply(await api.getDetail<FalixData>(id));
        return;
      } catch (e) {
        if (!alive) return;
        if (!isNotFound(e)) {
          setError(errMsg(e));
          return;
        }
      }
      // Attempt 2: IMDB-keyed entry via the title's external ids.
      try {
        const ext = await tmdbApi.getExternalIds(type as "movie" | "tv", id);
        const imdbNum = String(ext?.imdb_id ?? "")
          .replace(/^tt/i, "")
          .replace(/^0+(?=\d)/, "");
        if (imdbNum && /^\d+$/.test(imdbNum)) {
          try {
            apply(await api.getDetail<FalixData>(imdbNum));
            return;
          } catch (e2) {
            if (!alive) return;
            if (!isNotFound(e2)) {
              setError(errMsg(e2));
              return;
            }
          }
        }
      } catch (eExt) {
        // External-ids lookup failed (network/proxy) — retryable, so surface
        // it as an error rather than a false "not found".
        if (alive) setError(errMsg(eExt));
        return;
      }
      // Both lookups missed → leave data unset; the not-found card renders.
      if (alive) setData(null);
    })().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [available, id, type]);

  const isTV = data?.type === "tv";

  const currentEpisodes = useMemo(() => {
    if (!data || data.type !== "tv") return [];
    const season = data.seasons?.find(
      (s) => s.season_number === selectedSeason,
    );
    return season?.episodes || [];
  }, [data, selectedSeason]);

  // Expand/collapse all episodes in the selected season at once.
  const allExpanded =
    currentEpisodes.length > 0 &&
    currentEpisodes.every((ep) => expandedEpisodes[ep.episode_number]);

  const toggleAllEpisodes = () => {
    if (allExpanded) {
      setExpandedEpisodes({});
    } else {
      const next: Record<number, boolean> = {};
      for (const ep of currentEpisodes) next[ep.episode_number] = true;
      setExpandedEpisodes(next);
    }
  };

  /** Enqueue one file; filename mirrors mobile's convention. */
  const downloadFile = useCallback(
    (file: FalixTelegramFile, opts?: { season?: number; episode?: number }) => {
      if (!data) return;
      const url = buildDownloadUrl(file.id, file.name);
      const ext = file.name.split(".").pop() || "mkv";
      const ss = String(opts?.season ?? 1).padStart(2, "0");
      const ee = String(opts?.episode ?? 1).padStart(2, "0");
      const filename =
        opts?.episode != null
          ? `${data.title}-S${ss}E${ee}-${file.quality}.${ext}`
          : `${data.title}-${file.quality}.${ext}`;

      startDownload({
        url,
        title: filename,
        tmdbId: id,
        mediaType: data.type,
        season: opts?.season,
        episode: opts?.episode,
      });
    },
    [data, id],
  );

  const openInBrowser = (fileId: string, fileName: string) => {
    void window.electronAPI?.app?.openExternal?.(
      buildDownloadUrl(fileId, fileName),
    );
  };

  // ── Bulk calculation ──
  const bulkInfo = useMemo(() => {
    if (!data || data.type !== "tv") return null;
    let totalBytes = 0;
    let validCount = 0;
    const selections: Array<{ ep: FalixEpisode; file: FalixTelegramFile }> = [];
    for (const ep of currentEpisodes) {
      const sorted = [...(ep.telegram || [])].sort(sortByQuality);
      const file = getFileByTier(sorted, bulkQualityTier);
      if (file) {
        totalBytes += parseSizeToBytes(file.size);
        validCount++;
        selections.push({ ep, file });
      }
    }
    return {
      totalBytes,
      totalFormatted: formatBytes(totalBytes),
      validCount,
      totalEpisodes: currentEpisodes.length,
      selections,
    };
  }, [data, currentEpisodes, bulkQualityTier]);

  const handleBulkDownload = () => {
    if (!bulkInfo || bulkInfo.selections.length === 0 || !data) return;
    if (!confirmBulk) {
      setConfirmBulk(true);
      setTimeout(() => setConfirmBulk(false), 4000); // auto-disarm
      return;
    }
    setConfirmBulk(false);
    for (const { ep, file } of bulkInfo.selections) {
      downloadFile(file, {
        season: selectedSeason,
        episode: ep.episode_number,
      });
    }
  };

  // ── Gates ──
  if (!available) {
    return <DesktopGate />;
  }

  if (!type || !id) {
    return (
      <Shell>
        <StateCard
          icon={<AlertCircle className="h-8 w-8 text-[#E05252]" />}
          title="Download unavailable"
          body="This falix link is malformed."
          action={
            <Link href="/" className="text-sm text-[#D4A237] hover:underline">
              Go home
            </Link>
          }
        />
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <div className="py-24 text-center">
          <Loader2
            size={32}
            className="animate-spin text-[#D4A237] mx-auto mb-4"
          />
          <p className="text-sm text-muted-foreground">
            Loading download info…
          </p>
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <StateCard
          icon={<AlertCircle className="h-8 w-8 text-[#E05252]" />}
          title="Failed to load"
          body={error}
          action={
            <button
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
            >
              Retry
            </button>
          }
        />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <StateCard
          icon={<FolderOpen className="h-8 w-8 text-faint" />}
          title="No data available"
          body="Falix has no entry for this title."
          action={
            <Link href="/" className="text-sm text-[#D4A237] hover:underline">
              Go home
            </Link>
          }
        />
      </Shell>
    );
  }

  return (
    <div className="min-h-screen bg-[#070708] text-foreground relative">
      {/* Backdrop hero */}
      {data.backdrop && (
        <div className="absolute inset-x-0 top-0 h-[420px] overflow-hidden pointer-events-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.backdrop}
            alt=""
            className="w-full h-full object-cover blur-2xl scale-110 opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#070708]/60 via-[#070708]/80 to-[#070708]" />
        </div>
      )}

      <Header />

      <PageShell variant="hero" maxWidth="3xl" className="relative">
        {/* Poster + meta */}
        <div className="flex items-start gap-5 mb-8 flex-wrap">
          {data.poster && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={data.poster}
              alt={data.title}
              className="w-[115px] h-[172px] rounded-xl object-cover ring-1 ring-white/10 shrink-0"
            />
          )}
          <div className="flex-1 min-w-[240px] pt-1">
            <h1
              className="text-2xl sm:text-3xl font-bold leading-tight tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {data.title}
            </h1>

            <div className="flex items-center gap-2 mt-3 flex-wrap text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1 font-bold text-[#D4A237]">
                <Star size={11} fill="currentColor" />
                {data.rating ? data.rating.toFixed(1) : "—"}
              </span>
              <span className="text-faint">{data.release_year}</span>
              <span className="text-faint">·</span>
              <span className="text-faint">{data.rip}</span>
              {data.type === "movie" && Number(data.runtime) > 0 && (
                <>
                  <span className="text-faint">·</span>
                  <span className="text-faint">{data.runtime}m</span>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {(data.genres || []).slice(0, 4).map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-foreground/90"
                >
                  {g}
                </span>
              ))}
            </div>

            {/* Audio languages from the API — same sky-chip language as file
                rows below, so hero and files read as one system. */}
            {(data.languages || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {data.languages.map((l) => (
                  <span
                    key={l}
                    className="rounded bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium text-sky-300"
                  >
                    {l}
                  </span>
                ))}
              </div>
            )}

            {!isTV && data.type === "movie" && data.telegram?.length > 0 && (
              <button
                onClick={() =>
                  downloadFile([...data.telegram].sort(sortByQuality)[0])
                }
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#D4A237] px-4 py-2.5 text-[13px] font-semibold text-[#070708] hover:bg-[#B88B2A] transition-all"
              >
                <Download size={15} />
                Best Quality
              </button>
            )}
          </div>
        </div>

        {/* About */}
        {data.description && (
          <section className="mb-8">
            <h2
              className="text-base font-bold mb-2"
              style={{ fontFamily: "var(--font-display)" }}
            >
              About
            </h2>
            <p
              ref={descRef}
              className={`text-sm leading-relaxed text-muted-foreground max-w-2xl ${
                showFullDesc ? "" : "line-clamp-3"
              }`}
            >
              {data.description}
            </p>
            {(descOverflows || showFullDesc) && (
              <button
                onClick={() => setShowFullDesc((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#D4A237] hover:text-[#B88B2A] transition-colors"
                aria-expanded={showFullDesc}
              >
                {showFullDesc ? (
                  <>
                    See less
                    <ChevronUp size={13} />
                  </>
                ) : (
                  <>
                    See more
                    <ChevronDown size={13} />
                  </>
                )}
              </button>
            )}
          </section>
        )}

        {/* TV — bulk panel */}
        {isTV && currentEpisodes.length > 0 && (
          <section className="mb-6">
            <BulkPanel
              season={selectedSeason}
              episodeCount={currentEpisodes.length}
              tier={bulkQualityTier}
              onTier={setBulkQualityTier}
              expanded={showBulkPanel}
              onToggle={() => setShowBulkPanel((v) => !v)}
              info={bulkInfo}
              confirm={confirmBulk}
              onDownloadAll={handleBulkDownload}
            />
          </section>
        )}

        {/* TV — season tabs + episodes */}
        {isTV && (
          <section className="mb-10">
            <div className="flex gap-2 overflow-x-auto pb-1 mb-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(data.seasons || []).map((s) => (
                <button
                  key={s.season_number}
                  onClick={() => {
                    setSelectedSeason(s.season_number);
                    if (s.episodes?.length) {
                      setExpandedEpisodes({
                        [s.episodes[0].episode_number]: true,
                      });
                    }
                  }}
                  className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-bold transition-all ${
                    selectedSeason === s.season_number
                      ? "bg-[#D4A237] text-[#070708]"
                      : "bg-white/[0.04] text-foreground/90 border border-white/[0.06] hover:bg-white/[0.07]"
                  }`}
                >
                  Season {s.season_number}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 mb-3">
              <h2
                className="text-base font-bold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Season {selectedSeason} Episodes
              </h2>
              {currentEpisodes.length > 1 && (
                <button
                  onClick={toggleAllEpisodes}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
                  aria-label={
                    allExpanded
                      ? "Collapse all episodes"
                      : "Expand all episodes"
                  }
                >
                  {allExpanded ? (
                    <ChevronsDownUp size={14} />
                  ) : (
                    <ChevronsUpDown size={14} />
                  )}
                  {allExpanded ? "Collapse All" : "Expand All"}
                </button>
              )}
            </div>

            {currentEpisodes.length === 0 ? (
              <p className="text-sm text-faint py-8 text-center">
                No episodes found
              </p>
            ) : (
              <div className="space-y-2.5">
                {currentEpisodes.map((ep) => (
                  <EpisodeCard
                    key={ep.episode_number}
                    ep={ep}
                    expanded={expandedEpisodes[ep.episode_number] ?? false}
                    onToggle={() =>
                      setExpandedEpisodes((prev) => ({
                        ...prev,
                        [ep.episode_number]: !prev[ep.episode_number],
                      }))
                    }
                    downloads={downloads}
                    onDownload={(file) =>
                      downloadFile(file, {
                        season: selectedSeason,
                        episode: ep.episode_number,
                      })
                    }
                    onOpen={(f) => openInBrowser(f.id, f.name)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Movie — download options */}
        {!isTV && data.telegram?.length > 0 && (
          <section className="mb-10">
            <h2
              className="text-base font-bold mb-3"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Download Options
            </h2>
            <div className="space-y-2">
              {[...data.telegram].sort(sortByQuality).map((file) => (
                <FalixFileRow
                  key={file.id + file.name}
                  file={file}
                  downloads={downloads}
                  onDownload={() => downloadFile(file)}
                  onOpen={() => openInBrowser(file.id, file.name)}
                />
              ))}
            </div>
          </section>
        )}

        <div className="flex items-center justify-between rounded-xl bg-[#0E0E11] border border-white/[0.06] px-4 py-3">
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
      </PageShell>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#070708] text-foreground">
      <Header />
      <PageShell maxWidth="3xl">{children}</PageShell>
    </div>
  );
}

function DesktopGate() {
  return (
    <Shell>
      <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-14 text-center">
        <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center mx-auto mb-5">
          <Download className="h-8 w-8 text-[#D4A237]" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Downloads need the desktop app
        </h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
          Falix HEVC downloads run inside FilmSnaps Desktop. Install it to grab
          movies and full seasons offline.
        </p>
        <Link
          href="/download"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
        >
          Get FilmSnaps Desktop
        </Link>
      </div>
    </Shell>
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

function BulkPanel({
  season,
  episodeCount,
  tier,
  onTier,
  expanded,
  onToggle,
  info,
  confirm,
  onDownloadAll,
}: {
  season: number;
  episodeCount: number;
  tier: QualityTier;
  onTier: (t: QualityTier) => void;
  expanded: boolean;
  onToggle: () => void;
  info: {
    totalFormatted: string;
    validCount: number;
    totalEpisodes: number;
    selections: Array<{
      ep: { episode_number: number };
      file: FalixTelegramFile;
    }>;
  } | null;
  confirm: boolean;
  onDownloadAll: () => void;
}) {
  const disabled = !info || info.validCount === 0;
  return (
    <div className="rounded-2xl bg-[#0E0E11] border border-[#D4A237]/25 overflow-hidden mb-2">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-[#D4A237]/15 flex items-center justify-center">
            <Layers size={17} className="text-[#D4A237]" />
          </span>
          <span>
            <span className="block text-[15px] font-bold">
              Download All Episodes
            </span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Season {season} · {episodeCount} episodes
            </span>
          </span>
        </span>
        {expanded ? (
          <ChevronUp size={19} className="text-faint" />
        ) : (
          <ChevronDown size={19} className="text-faint" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Tier selector */}
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Choose Quality for All
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TIER_META) as QualityTier[]).map((t) => {
              const active = t === tier;
              const meta = TIER_META[t];
              return (
                <button
                  key={t}
                  onClick={() => onTier(t)}
                  className={`rounded-xl px-2 py-3 flex flex-col items-center gap-1 border-[1.5px] transition-all ${
                    active
                      ? "bg-[#D4A237]/15 border-[#D4A237]"
                      : "bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.05]"
                  }`}
                >
                  <span className={active ? "text-[#D4A237]" : "text-faint"}>
                    {meta.icon}
                  </span>
                  <span
                    className={`text-[13px] font-bold ${
                      active ? "text-[#D4A237]" : "text-foreground/90"
                    }`}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-faint text-center">
                    {meta.desc}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Totals */}
          {info && (
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3.5">
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">
                  Estimated Total Size
                </p>
                <p className="text-xl font-extrabold">{info.totalFormatted}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground mb-0.5">
                  Episodes
                </p>
                <p className="text-base font-bold text-[#D4A237]">
                  {info.validCount}/{info.totalEpisodes}
                </p>
              </div>
            </div>
          )}

          {/* Preview */}
          {info && info.selections.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-faint mb-2">
                Preview ({info.selections.length} files)
              </p>
              <div className="max-h-[140px] overflow-y-auto pr-1">
                {info.selections.map(({ ep, file }, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0"
                  >
                    <span className="text-xs text-foreground/90 truncate min-w-0">
                      E{String(ep.episode_number).padStart(2, "0")} —{" "}
                      {file.name}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-faint shrink-0">
                      {file.size}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirm-style download-all button */}
          <button
            onClick={onDownloadAll}
            disabled={disabled}
            className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-extrabold transition-all ${
              disabled
                ? "bg-[#D4A237]/40 text-[#070708]/60 cursor-not-allowed"
                : confirm
                  ? "bg-[#3FB950] text-[#070708]"
                  : "bg-[#D4A237] text-[#070708] hover:bg-[#B88B2A]"
            }`}
          >
            <Download size={17} />
            {confirm
              ? `Confirm ${info?.validCount} episodes (${info?.totalFormatted})?`
              : `Download All (${info?.totalFormatted || "0 B"})`}
          </button>
        </div>
      )}
    </div>
  );
}

function EpisodeCard({
  ep,
  expanded,
  onToggle,
  downloads,
  onDownload,
  onOpen,
}: {
  ep: FalixEpisode;
  expanded: boolean;
  onToggle: () => void;
  downloads: ReturnType<typeof useDownloadList>;
  onDownload: (file: FalixTelegramFile) => void;
  onOpen: (file: FalixTelegramFile) => void;
}) {
  const sortedFiles = useMemo(
    () => [...(ep.telegram || [])].sort(sortByQuality),
    [ep.telegram],
  );

  return (
    <div className="rounded-xl bg-[#0E0E11] border border-[#222226] overflow-hidden hover:border-[#D4A237]/20 transition-all">
      {/* Episode header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-3 flex-1 min-w-0">
          {ep.episode_backdrop && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={ep.episode_backdrop}
              alt=""
              className="w-[72px] h-[42px] rounded-lg object-cover shrink-0 ring-1 ring-white/10"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">
              Episode {ep.episode_number}
            </span>
            <span className="block text-[13px] text-muted-foreground leading-snug">
              {ep.title || "Untitled Episode"}
            </span>
          </span>
        </span>
        {expanded ? (
          <ChevronUp size={18} className="text-faint shrink-0" />
        ) : (
          <ChevronDown size={18} className="text-faint shrink-0" />
        )}
      </button>

      {/* File rows */}
      {expanded && sortedFiles.length > 0 && (
        <div className="px-3.5 pb-3.5 pt-2 border-t border-white/[0.05] space-y-1.5">
          {sortedFiles.map((file) => (
            <FalixFileRow
              key={file.id + file.name}
              file={file}
              downloads={downloads}
              onDownload={() => onDownload(file)}
              onOpen={() => onOpen(file)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Row for one falix file. Matched against the store BY URL (desktop tasks
 * don't carry server/quality fields like mobile's store).
 */
function FalixFileRow({
  file,
  downloads,
  onDownload,
  onOpen,
}: {
  file: FalixTelegramFile;
  downloads: ReturnType<typeof useDownloadList>;
  onDownload: () => void;
  onOpen: () => void;
}) {
  const langs = useMemo(() => extractLanguages(file.name), [file.name]);
  const task = useMemo(
    () => downloads.find((t) => t.url === buildDownloadUrl(file.id, file.name)),
    [downloads, file.id, file.name],
  );
  const isActive = task?.state === "active" || task?.state === "paused";
  const progress =
    task && task.totalBytes > 0
      ? Math.min(task.receivedBytes / task.totalBytes, 1)
      : 0;

  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] px-3 py-3 transition-colors">
      <div className="flex-1 min-w-0">
        {/* Filename — the row's identity. End-truncated, never broken mid-word;
            the full release name (with every language tag) is on hover. */}
        <p
          className="text-[13px] font-medium text-foreground truncate leading-snug"
          title={file.name}
        >
          {file.name}
        </p>

        {/* Metadata line — quality + audio languages + size */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className="rounded bg-[#D4A237]/15 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-[#D4A237]">
            {(file.quality || "?").toUpperCase()}
          </span>
          {langs.map((lang) => (
            <span
              key={lang}
              className="rounded bg-sky-400/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-300"
            >
              {lang}
            </span>
          ))}
          <span className="ml-auto pl-2 text-[11px] font-mono tabular-nums text-faint shrink-0">
            {file.size}
          </span>
        </div>

        {isActive && progress > 0 && (
          <div className="mt-1.5 h-1 w-28 rounded-full bg-white/[0.07] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#D4A237] transition-all"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>

      {isActive ? (
        <Loader2 size={18} className="animate-spin text-[#D4A237] shrink-0" />
      ) : task?.state === "completed" ? (
        <CheckCircle2 size={18} className="text-[#3FB950] shrink-0" />
      ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onOpen}
            aria-label="Open in browser"
            title="Open in browser"
            className="w-9 h-9 rounded-full bg-white/[0.05] hover:bg-white/[0.09] flex items-center justify-center transition-colors"
          >
            <ExternalLink size={14} className="text-muted-foreground" />
          </button>
          <button
            onClick={onDownload}
            aria-label="Download"
            title="Download"
            className="w-9 h-9 rounded-full bg-[#D4A237] hover:bg-[#B88B2A] flex items-center justify-center transition-colors"
          >
            <Download size={14} className="text-[#070708]" />
          </button>
        </div>
      )}
    </div>
  );
}
