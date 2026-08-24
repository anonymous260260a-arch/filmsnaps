/**
 * GlobalTopBar — unified title bar for the frameless Electron window.
 *
 * Fixes over previous revision:
 *  - Title is truly centered via absolute overlay (not flex-1 residual space)
 *  - Single search trigger (the pill); SearchPalette is now a pure overlay
 *  - ⌘K is handled HERE only — no duplicate listeners
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Search,
  Minus,
  Square,
  Copy,
  X,
} from "lucide-react";
import { useChromeStore } from "./chrome-store";
import { SearchPalette } from "./SearchPalette";

/* ── Constants ─────────────────────────────────────────────────────────── */

const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const WIN_CLOSE_RED = "#e81123";

/* ── Page-title map ────────────────────────────────────────────────────── */

const PAGE_TITLES: Array<{ prefix: string; title: string }> = [
  { prefix: "/movie", title: "Movies" },
  { prefix: "/tv", title: "TV Shows" },
  { prefix: "/saved", title: "Saved" },
  { prefix: "/history", title: "History" },
  { prefix: "/download", title: "Downloads" },
  { prefix: "/search", title: "Search" },
  { prefix: "/versions", title: "Versions" },
  { prefix: "/legal", title: "Legal & DMCA" },
  { prefix: "/privacy", title: "Privacy Policy" },
  { prefix: "/how-it-works", title: "How Content Works" },
];

function titleForPath(pathname: string): string {
  if (pathname === "/" || pathname === "") return "Home";
  for (const { prefix, title } of PAGE_TITLES) {
    if (pathname.startsWith(prefix)) return title;
  }
  return "FilmSnaps";
}

function formatSE(season: number, episode: number): string {
  const s = season < 10 ? `0${season}` : `${season}`;
  const e = episode < 10 ? `0${episode}` : `${episode}`;
  return `S${s}:E${e}`;
}

/* ── Platform detection ────────────────────────────────────────────────── */

function usePlatform() {
  const [platform, setPlatform] = useState<"mac" | "win" | "linux">("win");
  useEffect(() => {
    const p = navigator.platform ?? "";
    setPlatform(
      /Mac|Darwin/i.test(p) ? "mac" : /Win/i.test(p) ? "win" : "linux",
    );
  }, []);
  return platform;
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function GlobalTopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { watchContext, immersive } = useChromeStore();
  const platform = usePlatform();
  const isMac = platform === "mac";

  const [maximized, setMaximized] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [navStateKnown, setNavStateKnown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout>>(null);

  /* ── Maximize state ── */

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.isMaximized) return;
    api
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
    const off = api.onMaximizeChange?.(setMaximized);
    return () => {
      off?.();
    };
  }, []);

  /* ── Nav state ── */

  const refreshNavState = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.canGoBack) return;
    const [back, fwd] = await Promise.all([
      api.canGoBack().catch(() => false),
      api.canGoForward?.().catch(() => false) ?? Promise.resolve(false),
    ]);
    setCanBack(back);
    setCanForward(fwd);
    setNavStateKnown(true);
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    const off = api?.onNavigationStateChange?.(
      (state: { canGoBack: boolean; canGoForward: boolean }) => {
        setCanBack(state.canGoBack);
        setCanForward(state.canGoForward);
        setNavStateKnown(true);
      },
    );
    refreshNavState();
    return () => {
      off?.();
    };
  }, [pathname, refreshNavState]);

  /* ── Loading bar ── */

  useEffect(() => {
    const off = window.electronAPI?.onLoadingChange?.((isLoading: boolean) => {
      setLoading(isLoading);
    });
    return () => {
      off?.();
    };
  }, []);

  /* ── Nav handlers ── */

  const handleBack = useCallback(() => {
    if (window.electronAPI?.goBack) window.electronAPI.goBack();
    else if (window.history.length > 1) router.back();
  }, [router]);

  const handleForward = useCallback(() => {
    if (window.electronAPI?.goForward) window.electronAPI.goForward();
    else if (typeof router.forward === "function") router.forward();
  }, [router]);

  const handleReload = useCallback(() => {
    setSpinning(true);
    if (spinTimer.current) clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpinning(false), 600);
    if (window.electronAPI?.reload) window.electronAPI.reload();
    else window.location.reload();
  }, []);

  useEffect(
    () => () => {
      if (spinTimer.current) clearTimeout(spinTimer.current);
    },
    [],
  );

  const handleTitleClick = useCallback(() => {
    router.push("/");
  }, [router]);

  /* ── Keyboard: ⌘K (search) + Alt+←/→ (nav) — SINGLE owner, no duplicates ── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        handleBack();
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        handleForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleBack, handleForward]);

  /* ── Sidebar's search button dispatches this event ── */

  useEffect(() => {
    const open = () => setSearchOpen(true);
    window.addEventListener("filmsnaps:open-search", open);
    return () => window.removeEventListener("filmsnaps:open-search", open);
  }, []);

  /* ── Derived title ── */

  const seasonLabel =
    watchContext && watchContext.season != null && watchContext.episode != null
      ? formatSE(watchContext.season, watchContext.episode)
      : null;

  const title = watchContext?.title || titleForPath(pathname);
  const titleKey = `${title}${seasonLabel ?? ""}${watchContext?.year ?? ""}`;
  const mod = isMac ? "⌘" : "Ctrl+";

  const navBtn = (disabled: boolean) =>
    `flex items-center justify-center w-9 h-9 rounded-xl transition-all
     ${
       disabled
         ? "text-zinc-700 cursor-default"
         : "text-zinc-400 hover:text-white hover:bg-white/[0.08] active:scale-95 cursor-pointer"
     }`;

  return (
    <div
      role="toolbar"
      aria-label="Window controls"
      className={`relative z-50 flex h-12 select-none items-center border-b border-white/[0.04]
        bg-gradient-to-b from-[#111118] to-[#0a0a0f]
        transition-[opacity,transform] duration-200 motion-reduce:transition-none
        ${immersive ? "pointer-events-none -translate-y-full opacity-0" : "translate-y-0 opacity-100"}`}
      style={DRAG}
    >
      {/* ── Left: navigation cluster ── */}
      <div
        className="relative z-10 flex items-center gap-0.5 py-1.5 pl-3 pr-2"
        style={NO_DRAG}
      >
        <button
          onClick={handleBack}
          disabled={navStateKnown && !canBack}
          className={navBtn(navStateKnown && !canBack)}
          aria-label="Go back"
          title={canBack ? "Back  (Alt+←)" : undefined}
        >
          <ArrowLeft size={17} strokeWidth={2} />
        </button>
        <button
          onClick={handleForward}
          disabled={navStateKnown && !canForward}
          className={navBtn(navStateKnown && !canForward)}
          aria-label="Go forward"
          title={canForward ? "Forward  (Alt+→)" : undefined}
        >
          <ArrowRight size={17} strokeWidth={2} />
        </button>
        <button
          onClick={handleReload}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl
            text-zinc-500 transition-all hover:bg-white/[0.06] hover:text-zinc-200 active:scale-95"
          aria-label="Reload"
          title="Reload"
        >
          <RotateCw
            size={15}
            strokeWidth={2}
            className={spinning || loading ? "tb-spin" : "transition-transform"}
          />
        </button>
      </div>

      {/* Spacer pushes the right cluster to the far edge */}
      <div className="flex-1" />

      {/* ── Right: search trigger + window controls ── */}
      <div
        className="relative z-10 flex items-center gap-1 pr-1"
        style={NO_DRAG}
      >
        <button
          onClick={() => setSearchOpen(true)}
          className="group flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.06]
            bg-white/[0.03] py-1.5 pl-2.5 pr-2 text-zinc-500 transition-all
            hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-zinc-300"
          aria-label="Search"
          title={`Search  (${mod}K)`}
        >
          <Search
            size={14}
            strokeWidth={2}
            className="transition-transform group-hover:scale-110"
          />
          <span className="hidden text-xs font-medium sm:inline">Search</span>
          <kbd
            className="rounded border border-white/[0.08] bg-white/[0.05] px-1.5 py-px
            text-[11px] font-semibold text-zinc-600 group-hover:text-zinc-400"
          >
            {mod}K
          </kbd>
        </button>
      </div>

      {/* Window controls — Windows / Linux only */}
      {!isMac && (
        <div
          className="relative z-10 flex self-stretch items-stretch"
          style={NO_DRAG}
        >
          <div className="mx-1.5 h-5 w-px self-center bg-white/[0.06]" />
          <button
            onClick={() => window.electronAPI?.minimize()}
            className="flex w-12 cursor-pointer items-center justify-center text-zinc-500
              transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
            aria-label="Minimize"
          >
            <Minus size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => window.electronAPI?.maximize()}
            className="flex w-12 cursor-pointer items-center justify-center text-zinc-500
              transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
            aria-label={maximized ? "Restore down" : "Maximize"}
          >
            {maximized ? (
              <Copy size={13} strokeWidth={1.5} />
            ) : (
              <Square size={11} strokeWidth={1.5} />
            )}
          </button>
          <button
            onClick={() => window.electronAPI?.close()}
            className="flex w-12 cursor-pointer items-center justify-center text-zinc-500
              transition-colors hover:text-white"
            aria-label="Close"
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = WIN_CLOSE_RED)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "transparent")
            }
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* ── True-center title (absolute overlay, doesn't affect flex layout) ── */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center"
        style={NO_DRAG}
      >
        <button
          onClick={handleTitleClick}
          className="pointer-events-auto group flex min-w-0 cursor-pointer items-center gap-3
            rounded-lg px-2 py-1 transition-opacity hover:opacity-80"
          title="Back to Home"
        >
          <span
            key={titleKey}
            className="tb-fade flex min-w-0 items-center gap-3"
          >
            <span
              className="max-w-[300px] truncate text-sm font-bold text-foreground"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </span>
            {seasonLabel && (
              <span className="flex shrink-0 items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-[#D4A237]" />
                <span className="text-xs font-black tracking-wide text-[#D4A237]">
                  {seasonLabel}
                </span>
              </span>
            )}
            {!seasonLabel && watchContext?.year && (
              <span className="flex shrink-0 items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-zinc-600" />
                <span className="text-xs font-bold text-zinc-400">
                  {watchContext.year}
                </span>
              </span>
            )}
          </span>
        </button>
      </div>

      {/* ── Search palette (pure overlay — no internal trigger) ── */}
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />

      {/* ── Loading bar ── */}
      {loading && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
        >
          <div className="tb-loading h-full w-1/3 bg-gradient-to-r from-transparent via-[#D4A237] to-transparent" />
        </div>
      )}

      <style>{`
        @keyframes tb-fade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes tb-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes tb-loading {
          from { transform: translateX(-120%); }
          to   { transform: translateX(420%); }
        }
        .tb-fade    { animation: tb-fade .25s cubic-bezier(.2,.8,.2,1) both; }
        .tb-spin    { animation: tb-spin .6s cubic-bezier(.4,.1,.3,1) both; }
        .tb-loading { animation: tb-loading 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .tb-fade, .tb-spin, .tb-loading { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
