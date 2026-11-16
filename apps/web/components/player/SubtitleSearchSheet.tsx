/**
 * SubtitleSearchSheet — online subtitle search for mpv playback (mobile
 * parity with SubtitleSheet's "Load subtitles online" section).
 *
 * Queries the web app's /api/subtitles proxy (Subdl → Wyzie, API keys live
 * server-side). Picking an entry downloads the file in the Electron main
 * process and feeds it to mpv via memory:// — no CORS, no temp files. The
 * loaded track appears in the player's subtitle menu immediately.
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, Search, Loader2, Captions, Download } from "lucide-react";
import { apiUrl, apiClientHeaders } from "@/lib/tmdb";
import { prettyReleaseName, englishFirst } from "@/lib/subtitleName";

interface SubtitleEntry {
  releaseName: string;
  language: string;
  url: string;
  format: string;
  hi: boolean;
}

interface SubtitleSearchSheetProps {
  open: boolean;
  tmdbId: string;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
  onClose: () => void;
  /** Load a subtitle URL. Resolves true when the player accepted it. The
   *  full entry rides along — the web (movi) player needs its format and
   *  language to key the track; mpv ignores it. */
  onPick: (
    url: string,
    title: string,
    entry: SubtitleEntry,
  ) => Promise<boolean>;
}

export function SubtitleSearchSheet({
  open,
  tmdbId,
  mediaType,
  season,
  episode,
  onClose,
  onPick,
}: SubtitleSearchSheetProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loadingPick, setLoadingPick] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Fresh search each time the sheet opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPickError(null);
    setEntries([]);
    setQuery("");
    const params = new URLSearchParams({ tmdb_id: tmdbId, type: mediaType });
    if (mediaType === "tv") {
      if (season != null) params.set("season_number", String(season));
      if (episode != null) params.set("episode_number", String(episode));
    }
    fetch(apiUrl(`/api/subtitles?${params.toString()}`), {
      headers: apiClientHeaders(),
    })
      .then((r) =>
        r.json().then((data) => ({ ok: r.ok, status: r.status, data })),
      )
      .then(({ ok, status, data }) => {
        if (cancelled) return;
        if (!ok) {
          setError(
            (data as any)?.error || `Subtitle search failed (${status})`,
          );
          return;
        }
        // English (device locale) first — mobile parity.
        setEntries(
          englishFirst(
            ((data as any)?.subtitles ?? []) as SubtitleEntry[],
            (e) => e.language,
          ),
        );
      })
      .catch(() => {
        if (!cancelled)
          setError("Subtitle search failed — check your connection.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tmdbId, mediaType, season, episode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    // Match against BOTH the raw release name (exact tags, group names) and
    // the prettified title the rows display.
    return entries.filter((e) =>
      `${e.releaseName} ${prettyReleaseName(e.releaseName)} ${e.language}`
        .toLowerCase()
        .includes(q),
    );
  }, [entries, query]);

  const handlePick = async (entry: SubtitleEntry) => {
    setLoadingPick(entry.url);
    setPickError(null);
    let ok = false;
    try {
      // The pretty name becomes the track title — what the CC menus show.
      ok = await onPick(entry.url, prettyReleaseName(entry.releaseName), entry);
    } catch {
      ok = false;
    }
    setLoadingPick(null);
    if (ok) onClose();
    else setPickError("Couldn't load that subtitle — try another one.");
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-elevated rounded-2xl w-[480px] max-h-[80vh] flex flex-col border border-white/[0.08] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Captions size={16} className="text-primary" />
              Subtitles
            </h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              Search online — loads straight into the player
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter box */}
        <div className="px-5 py-3 border-b border-white/[0.04]">
          <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-3 py-2">
            <Search size={14} className="text-white/30 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by release or language…"
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 size={22} className="animate-spin text-primary" />
              <p className="text-xs text-white/40">
                Searching subtitle providers…
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-white/40">
                {query
                  ? "No subtitles match that filter."
                  : "No subtitles found for this title."}
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            filtered.map((entry) => (
              <button
                key={entry.url}
                onClick={() => handlePick(entry)}
                disabled={loadingPick !== null}
                className="w-full text-left flex items-center gap-3 px-5 py-3 hover:bg-white/[0.04] transition-colors disabled:opacity-60"
              >
                <div className="flex-1 min-w-0">
                  {/* LANGUAGE is the heading (mobile parity) — the most
                      important thing on the row; the release name is second. */}
                  <p className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold uppercase tracking-wide text-white">
                      {entry.language}
                    </span>
                    {entry.hi && (
                      <span className="rounded bg-white/[0.07] border border-white/[0.08] px-1.5 py-px text-[10px] font-semibold text-white/50">
                        CC
                      </span>
                    )}
                    <span className="text-[10px] font-semibold text-white/35">
                      {entry.format.toUpperCase()}
                    </span>
                  </p>
                  {/* Prettified release name — "Resident Evil (2026) · 1080p
                      AMZN WEB-DL · Hindi, English" instead of the raw string */}
                  <p className="text-[12px] text-white/50 truncate mt-0.5">
                    {prettyReleaseName(entry.releaseName)}
                  </p>
                </div>
                {loadingPick === entry.url ? (
                  <Loader2
                    size={15}
                    className="text-primary animate-spin shrink-0"
                  />
                ) : (
                  <Download size={15} className="text-white/30 shrink-0" />
                )}
              </button>
            ))}

          {!loading && pickError && (
            <p className="px-5 py-3 text-xs text-red-400 border-t border-white/[0.06]">
              {pickError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
