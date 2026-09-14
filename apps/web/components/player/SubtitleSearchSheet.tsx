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
import { apiUrl } from "@/lib/tmdb";

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
  /** Load a subtitle URL. Resolves true when mpv accepted it. */
  onPick: (url: string, title: string) => Promise<boolean>;
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
    fetch(apiUrl(`/api/subtitles?${params.toString()}`))
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
        setEntries(((data as any)?.subtitles ?? []) as SubtitleEntry[]);
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
    return entries.filter((e) =>
      `${e.releaseName} ${e.language}`.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const handlePick = async (entry: SubtitleEntry) => {
    setLoadingPick(entry.url);
    setPickError(null);
    let ok = false;
    try {
      ok = await onPick(entry.url, entry.releaseName);
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
        className="relative bg-[#16161A] rounded-2xl w-[480px] max-h-[80vh] flex flex-col border border-white/[0.08] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Captions size={16} className="text-[#D4A237]" />
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
              <Loader2 size={22} className="animate-spin text-[#D4A237]" />
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
                  <p className="text-sm text-white truncate">
                    {entry.releaseName}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    {entry.language}
                    {entry.hi ? " · hearing impaired" : ""} ·{" "}
                    {entry.format.toUpperCase()}
                  </p>
                </div>
                {loadingPick === entry.url ? (
                  <Loader2
                    size={15}
                    className="text-[#D4A237] animate-spin shrink-0"
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
