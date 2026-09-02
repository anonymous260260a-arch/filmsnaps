/**
 * SearchPalette — Spotlight-style command palette for the desktop shell.
 *
 * Pure controlled overlay (no internal trigger button). Opened by:
 *   - GlobalTopBar's ⌘K / Ctrl+K shortcut
 *   - GlobalTopBar's search pill button
 *   - Sidebar's search row (via `filmsnaps:open-search` CustomEvent)
 *
 * UX goals — minimum clicks to content:
 *   ⌘K → type → ↑↓ to highlight → Enter to open.  Two keys + Enter.
 *   Or: ⌘K → click a recent / trending shortcut.  One click.
 */

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  Clock,
  Clapperboard,
  Tv,
  CornerDownLeft,
  X,
  Sparkles,
} from "lucide-react";
import { getImageUrl, rankSearchResults, smartSearch } from "@/lib/tmdb";
import type { ScoredResult } from "@/lib/tmdb";
import { animeSearch, rankAnimeSearchResults } from "@/lib/anime/search";
import type { ScoredAnimeResult } from "@/lib/anime/search";
import { useDebounce } from "@/hooks/useDebounce";
import { useQuery } from "@tanstack/react-query";
import { useAppMode } from "@/lib/useAppMode";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seed the query field (e.g. from a /search?q= deep link). */
  initialQuery?: string;
}

/* ── Recent searches (localStorage) ────────────────────────────────────── */

const RECENT_KEY = "filmsnaps:recent-searches";
const MAX_RECENTS = 5;

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecent(query: string) {
  const list = loadRecents().filter((q) => q !== query);
  list.unshift(query);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
}

function removeRecent(query: string) {
  const list = loadRecents().filter((q) => q !== query);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

/* ── Anime toggle (F9) — shared with /search via the same storage key ── */

const ANIME_TOGGLE_KEY = "fs:search-anime";

function saveAnimeMode(on: boolean) {
  try {
    localStorage.setItem(ANIME_TOGGLE_KEY, on ? "1" : "0");
  } catch {
    /* non-fatal */
  }
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function SearchPalette({
  open,
  onOpenChange,
  initialQuery,
}: SearchPaletteProps) {
  const router = useRouter();
  const { mode: appMode } = useAppMode();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [recents, setRecents] = useState<string[]>([]);
  // Anime mode — defaults to follow the global Hard Mode Split (anime → ON,
  // movie → OFF), and is freely flippable in any mode via toggleAnimeMode.
  const [animeMode, setAnimeMode] = useState(appMode === "anime");
  const debouncedQuery = useDebounce(query, 250);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /* ── Lifecycle: focus, scroll lock, recents load ── */

  // When the global Hard Mode Split changes, the toggle follows it (anime →
  // ON, movie → OFF) and the choice is mirrored. This is the only place the
  // global mode drives the toggle — a manual flip below sticks until the next
  // mode change (and across reopens within the same mode).
  useEffect(() => {
    setAnimeMode(appMode === "anime");
    saveAnimeMode(appMode === "anime");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode]);

  useEffect(() => {
    if (open) {
      setRecents(loadRecents());
      // Keep the current toggle state (a prior manual flip persists across
      // reopen); do NOT re-force it to the global mode here.
      // slight delay so the panel's mount animation doesn't fight focus
      requestAnimationFrame(() => inputRef.current?.focus());
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      // reset state after close animation
      const t = setTimeout(() => {
        setQuery("");
        setActiveIdx(-1);
      }, 150);
      return () => clearTimeout(t);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  /* ── Search query ──
     Both queries stay enabled so flipping the anime toggle swaps between
     cached result sets instantly (no refetch flash). AniList traffic goes
     through the edge-cached proxy — keeping it warm costs nothing upstream. */

  const { data: searchResults, isFetching: tmdbFetching } = useQuery({
    queryKey: ["palette-search", debouncedQuery],
    queryFn: () => smartSearch(debouncedQuery),
    enabled: debouncedQuery.length > 1,
    staleTime: 30_000,
    gcTime: 60_000,
  });

  const { data: animeData, isFetching: animeFetching } = useQuery({
    queryKey: ["palette-anime-search", debouncedQuery],
    queryFn: () => animeSearch(debouncedQuery),
    enabled: debouncedQuery.length > 1,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    // Upstream ceiling is ~90 req/min on AniList — no client retry storm
    // when the proxy reports an outage; the next keystroke re-fires anyway.
    retry: false,
  });

  const isFetching = animeMode ? animeFetching : tmdbFetching;

  const suggestions = useMemo<(ScoredResult | ScoredAnimeResult)[]>(() => {
    if (animeMode) {
      return animeData?.results
        ? rankAnimeSearchResults(animeData.results, debouncedQuery, 7)
        : [];
    }
    if (!searchResults?.results) return [];
    return rankSearchResults(searchResults.results, debouncedQuery, 7);
  }, [animeMode, animeData, searchResults, debouncedQuery]);

  const toggleAnimeMode = useCallback(() => {
    // Independent of the global Hard Mode Split — the toggle flips freely in
    // either mode without forcing the home/header split to change (spec).
    // Only the fs:search-anime mirror is updated (read on open for parity).
    setAnimeMode((v) => {
      const next = !v;
      saveAnimeMode(next);
      return next;
    });
  }, []);

  // reset keyboard selection when results change
  useEffect(() => {
    setActiveIdx(-1);
  }, [suggestions]);

  // scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && itemRefs.current[activeIdx]) {
      itemRefs.current[activeIdx]!.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  /* ── Navigation actions ── */

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const goToResult = useCallback(
    (item: ScoredResult | ScoredAnimeResult) => {
      saveRecent(query.trim());
      setRecents(loadRecents());
      close();
      if ("malId" in item) {
        // Anime result → TMDB-spine detail route carrying the anime identity
        // params (?mid=<mal>&aid=<anilist>) so the watch session is profiled.
        const type = item.tmdbShowId != null ? "tv" : "movie";
        const tmdbId = item.tmdbShowId ?? item.tmdbMovieId!;
        const aid = item.anilistId != null ? `&aid=${item.anilistId}` : "";
        router.push(`/${type}?id=${tmdbId}&mid=${item.malId}${aid}`);
        return;
      }
      const type = item.media_type || "movie";
      router.push(`/${type}?id=${item.id}`);
    },
    [query, close, router],
  );

  const goToFullSearch = useCallback(
    (q?: string) => {
      const term = (q ?? query).trim();
      if (!term) return;
      saveRecent(term);
      close();
      router.push(
        `/search?q=${encodeURIComponent(term)}${animeMode ? "&anime=1" : ""}`,
      );
    },
    [query, close, router, animeMode],
  );

  const goToCategory = useCallback(
    (path: string) => {
      close();
      router.push(path);
    },
    [close, router],
  );

  /* ── Keyboard navigation within the palette ── */

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      const total = suggestions.length;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i < total - 1 ? i + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i > 0 ? i - 1 : total - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeIdx >= 0 && activeIdx < total) {
          goToResult(suggestions[activeIdx]);
        } else {
          goToFullSearch();
        }
      }
    },
    [suggestions, activeIdx, close, goToResult, goToFullSearch],
  );

  /* ── Render nothing when closed ── */

  if (!open) return null;

  const showResults = query.trim().length > 1;
  const showEmpty = showResults && !isFetching && suggestions.length === 0;

  // Render through a portal to <body> so the overlay is NOT a descendant of
  // the top bar's -webkit-app-region: drag element. A no-drag child inside a
  // drag parent is unreliable in Electron (the region hit-test can still win);
  // mounting on body makes the backdrop/panel unconditionally clickable.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      {/* Backdrop */}
      <div
        className="sp-backdrop absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden
      />

      {/* Panel — positioned in the upper third, Spotlight-style */}
      <div
        className="sp-panel relative mt-[14vh] w-full max-w-[560px] overflow-hidden rounded-2xl
        border border-white/[0.08] bg-[#111116]/[0.97] shadow-[0_24px_80px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.03)_inset]
        backdrop-blur-2xl"
      >
        {/* ── Input row ── */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
          <Search
            size={18}
            strokeWidth={2}
            className="shrink-0 text-zinc-500"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              animeMode ? "Search MyAnimeList…" : "Search movies & TV shows…"
            }
            className="h-[52px] w-full bg-transparent text-[15px] text-zinc-100
              placeholder:text-zinc-600 outline-none"
            aria-label="Search query"
            autoComplete="off"
            spellCheck={false}
          />
          {/* Anime mode toggle — same storage key as /search */}
          <button
            onClick={toggleAnimeMode}
            title="Anime search (MyAnimeList)"
            aria-pressed={animeMode}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px]
              font-semibold transition-colors ${
                animeMode
                  ? "bg-[#D4A237]/15 text-[#D4A237] ring-1 ring-inset ring-[#D4A237]/30"
                  : "text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400"
              }`}
          >
            <Sparkles size={13} />
            Anime
          </button>
          {query ? (
            <button
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md
                text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd
              className="shrink-0 rounded border border-white/[0.08] bg-white/[0.04]
              px-1.5 py-0.5 text-[11px] font-medium text-zinc-600"
            >
              ESC
            </kbd>
          )}
        </div>

        {/* ── Content area ── */}
        <div ref={listRef} className="max-h-[340px] overflow-y-auto sp-scroll">
          {/* Idle state: recents + quick links */}
          {!showResults && (
            <div className="p-2">
              {recents.length > 0 && (
                <>
                  <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                    Recent
                  </p>
                  {recents.map((q) => (
                    <div key={q} className="group flex items-center">
                      <button
                        onClick={() => goToFullSearch(q)}
                        className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left
                          text-sm text-zinc-300 transition-colors hover:bg-white/[0.05]"
                      >
                        <Clock size={14} className="shrink-0 text-zinc-600" />
                        <span className="truncate">{q}</span>
                      </button>
                      <button
                        onClick={() => {
                          removeRecent(q);
                          setRecents(loadRecents());
                        }}
                        className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md
                          text-zinc-700 opacity-0 transition-all hover:bg-white/[0.06] hover:text-zinc-400
                          group-hover:opacity-100"
                        aria-label={`Remove "${q}" from recent searches`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <div className="mx-3 my-2 h-px bg-white/[0.05]" />
                </>
              )}

              <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                Quick Links
              </p>
              <button
                onClick={() => goToCategory("/movie")}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left
                  text-sm text-zinc-300 transition-colors hover:bg-white/[0.05]"
              >
                <Clapperboard
                  size={14}
                  className="shrink-0 text-[#D4A237]/70"
                />
                Browse Movies
              </button>
              <button
                onClick={() => goToCategory("/tv")}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left
                  text-sm text-zinc-300 transition-colors hover:bg-white/[0.05]"
              >
                <Tv size={14} className="shrink-0 text-[#D4A237]/70" />
                Browse TV Shows
              </button>
            </div>
          )}

          {/* Loading skeletons */}
          {showResults && isFetching && (
            <div className="space-y-1 p-2">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                >
                  <div className="h-12 w-9 shrink-0 animate-pulse rounded-md bg-white/[0.06]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/[0.04]" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Results */}
          {showResults && !isFetching && suggestions.length > 0 && (
            <div className="p-2">
              <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                Results
              </p>
              {suggestions.map((item, i) => {
                const isAnime = "malId" in item;
                const thumbSrc = isAnime
                  ? (item.image ?? "")
                  : getImageUrl(item.poster_path || item.poster, "w92") || "";
                const typeLabel = isAnime
                  ? `${item.type ?? "Anime"} · Anime`
                  : item.media_type === "tv"
                    ? "TV Show"
                    : "Movie";
                return (
                  <button
                    key={
                      isAnime
                        ? `a-${item.malId}`
                        : `${item.media_type}-${item.id}`
                    }
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    onClick={() => goToResult(item)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left
                    transition-colors ${i === activeIdx ? "bg-[#D4A237]/[0.08] ring-1 ring-inset ring-[#D4A237]/[0.15]" : "hover:bg-white/[0.04]"}`}
                  >
                    {/* Poster thumbnail */}
                    <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-white/[0.05]">
                      {thumbSrc && (
                        <img
                          src={thumbSrc}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>
                    {/* Meta */}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${i === activeIdx ? "font-semibold text-zinc-100" : "font-medium text-zinc-200"}`}
                      >
                        {isAnime
                          ? item.titleEnglish || item.title
                          : item.title || item.name}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            isAnime
                              ? "bg-violet-400/70"
                              : item.media_type === "tv"
                                ? "bg-sky-400/70"
                                : "bg-[#D4A237]/70"
                          }`}
                        />
                        <span>{typeLabel}</span>
                        {(isAnime
                          ? item.year != null
                          : !!(item.release_date || item.first_air_date)) && (
                          <>
                            <span className="text-zinc-700">·</span>
                            <span>
                              {isAnime
                                ? String(item.year)
                                : (item.release_date ||
                                    item.first_air_date)!.slice(0, 4)}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    {/* Enter hint on active */}
                    {i === activeIdx && (
                      <CornerDownLeft
                        size={13}
                        className="shrink-0 text-zinc-600"
                      />
                    )}
                  </button>
                );
              })}

              {/* See all results */}
              <button
                onClick={() => goToFullSearch()}
                onMouseEnter={() => setActiveIdx(-1)}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5
                  text-xs font-medium text-[#D4A237] transition-colors hover:bg-[#D4A237]/[0.06]"
              >
                <Search size={13} />
                See all results for &ldquo;{query.trim()}&rdquo;
              </button>
            </div>
          )}

          {/* No results */}
          {showEmpty && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Search size={28} strokeWidth={1.2} className="text-zinc-700" />
              <p className="text-sm text-zinc-500">
                No results for{" "}
                <span className="font-medium text-zinc-300">
                  &ldquo;{query.trim()}&rdquo;
                </span>
              </p>
              <p className="text-xs text-zinc-600">
                Try a different title, actor, or keyword.
              </p>
            </div>
          )}

          {/* Single character hint */}
          {query.trim().length === 1 && (
            <div className="px-4 py-8 text-center text-xs text-zinc-600">
              Keep typing to search…
            </div>
          )}
        </div>

        {/* ── Keyboard hints footer ── */}
        <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 py-px text-[11px]">
              ↑↓
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 py-px text-[11px]">
              ↵
            </kbd>
            open
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 py-px text-[11px]">
              esc
            </kbd>
            close
          </span>
          <span className="ml-auto text-[11px] text-zinc-700">
            {showResults && !isFetching
              ? `${suggestions.length} result${suggestions.length !== 1 ? "s" : ""}`
              : ""}
          </span>
        </div>
      </div>

      {/* Scoped animations */}
      <style>{`
        @keyframes sp-backdrop { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sp-panel {
          from { opacity: 0; transform: scale(0.97) translateY(-10px); }
          to   { opacity: 1; transform: none; }
        }
        .sp-backdrop { animation: sp-backdrop .15s ease both; }
        .sp-panel    { animation: sp-panel .2s cubic-bezier(.2,.8,.2,1) both; }
        .sp-scroll   { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.10) transparent; }
        .sp-scroll::-webkit-scrollbar { width: 6px; }
        .sp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 6px; }
        @media (prefers-reduced-motion: reduce) {
          .sp-backdrop, .sp-panel { animation: none !important; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
