/**
 * Sidebar — persistent vertical nav rail for the Electron shell.
 *
 * Desktop-shell concerns handled here:
 *  - macOS traffic-light clearance + `-webkit-app-region: drag` strip
 *    (pair with `titleBarStyle: 'hiddenInset'` in the main process)
 *  - Global shortcuts: ⌘/Ctrl+B toggle, ⌘/Ctrl+1…6 route jump, ⌘/Ctrl+K search
 *  - Sliding active-route indicator, animated collapse, live download meter
 *  - Non-selectable chrome, thin native scrollbars, reduced-motion support
 */

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Clapperboard,
  Tv,
  Bookmark,
  Clock,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  LogOut,
  LogIn,
  ChevronRight,
  ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useChromeStore, toggleSidebarCollapsed } from "./chrome-store";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useAuth } from "@/components/AuthProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ── Electron chrome constants ─────────────────────────────────────────── */

// Keep interactive content clear of the macOS signal lights.
// Tune to match `trafficLightPosition` in your BrowserWindow config.
const MAC_TRAFFIC_CLEARANCE = 38;

const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

// useLayoutEffect without the SSR warning during Next's server pass
const useIsoLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : useEffect;

/* ── Types ─────────────────────────────────────────────────────────────── */

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
};

/** Feed this from your main-process download manager over IPC. */
export type SidebarDownload = {
  label: string; // "Dune.Part.Two.2024.1080p.mkv"
  progress: number; // 0…1
  speed?: string; // "8.4 MB/s"
};

type SidebarProps = {
  /** ⌘K / search row handler. Defaults to dispatching `filmsnaps:open-search`. */
  onOpenSearch?: () => void;
  /** Live download telemetry (optional — renders a meter above the account row). */
  download?: SidebarDownload | null;
};

/* ── Component ─────────────────────────────────────────────────────────── */

export function Sidebar({ onOpenSearch, download = null }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed } = useChromeStore();
  const { savedMovies } = useWatchlist();
  const { user, signOut } = useAuth();

  const [isMac, setIsMac] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const [tip, setTip] = useState<{
    label: string;
    hint?: string;
    top: number;
  } | null>(null);
  const [indicator, setIndicator] = useState<{
    top: number;
    height: number;
  } | null>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());

  useEffect(() => {
    setIsMac(/Mac|Darwin/i.test(navigator.platform ?? ""));
  }, []);

  const mod = isMac ? "⌘" : "Ctrl+";

  /* ── Nav model: two groups, flattened for ⌘1…⌘6 ── */

  const groups = useMemo(
    () => [
      {
        label: "Browse",
        items: [
          { href: "/", label: "Home", icon: Home },
          { href: "/movie", label: "Movies", icon: Clapperboard },
          { href: "/tv", label: "TV Shows", icon: Tv },
        ] as NavItem[],
      },
      {
        label: "Library",
        items: [
          {
            href: "/saved",
            label: "Saved",
            icon: Bookmark,
            count: savedMovies?.length,
          },
          { href: "/history", label: "History", icon: Clock },
          { href: "/download", label: "Downloads", icon: Download },
        ] as NavItem[],
      },
    ],
    [savedMovies?.length],
  );

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const activeHref = useMemo(
    () => flat.find((i) => isActive(i.href))?.href ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, flat],
  );

  /* ── Sliding active indicator (measured, not guessed) ── */

  useIsoLayoutEffect(() => {
    if (!activeHref) return setIndicator(null);
    const el = linkRefs.current.get(activeHref);
    if (el) setIndicator({ top: el.offsetTop, height: el.offsetHeight });
  }, [activeHref, sidebarCollapsed, groups]);

  /* ── Search ── */

  const openSearch = useCallback(() => {
    if (onOpenSearch) return onOpenSearch();
    window.dispatchEvent(new CustomEvent("filmsnaps:open-search"));
  }, [onOpenSearch]);

  /* ── Global keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const inField =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);

      // ⌘K is handled by GlobalTopBar — do NOT intercept it here.
      if (e.key.toLowerCase() === "k") return;

      if (inField) return;
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebarCollapsed();
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= flat.length) {
        e.preventDefault();
        router.push(flat[n - 1].href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, router]);

  /* ── Collapsed-mode tooltip (fixed-positioned, escapes nav clipping) ── */

  const showTip = useCallback(
    (label: string, hint: string | undefined, el: HTMLElement) => {
      if (!sidebarCollapsed) return;
      const r = el.getBoundingClientRect();
      setTip({ label, hint, top: r.top + r.height / 2 });
    },
    [sidebarCollapsed],
  );
  const hideTip = useCallback(() => setTip(null), []);

  const pct = download
    ? Math.min(100, Math.max(0, Math.round(download.progress * 100)))
    : 0;

  /* ── Row renderer ── */

  const renderRow = (item: NavItem, idx: number) => {
    const Icon = item.icon;
    const active = item.href === activeHref;
    const delay = { animationDelay: `${50 + idx * 22}ms` };

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        ref={(el) => {
          if (el) linkRefs.current.set(item.href, el);
          else linkRefs.current.delete(item.href);
        }}
        onMouseEnter={(e) =>
          showTip(item.label, `${mod}${idx + 1}`, e.currentTarget)
        }
        onFocus={(e) =>
          showTip(item.label, `${mod}${idx + 1}`, e.currentTarget)
        }
        onMouseLeave={hideTip}
        onBlur={hideTip}
        className={`group relative z-[1] flex items-center gap-3 rounded-lg outline-none
          transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#D4A237]/50
          ${sidebarCollapsed ? "justify-center px-2 py-2" : "px-2.5 py-2"}
          ${active ? "text-zinc-100" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"}`}
      >
        <Icon
          size={18}
          strokeWidth={active ? 2.2 : 1.8}
          className={`shrink-0 transition-[color,transform] duration-150 group-hover:scale-110
            ${active ? "text-[#D4A237]" : "text-zinc-500 group-hover:text-zinc-200"}`}
        />
        {!sidebarCollapsed && (
          <>
            <span
              className={`sb-fade flex-1 truncate text-[13px] ${active ? "font-semibold" : "font-medium"}`}
              style={delay}
            >
              {item.label}
            </span>
            {item.count !== undefined && item.count > 0 ? (
              <span
                key={item.count}
                suppressHydrationWarning
                className="sb-pop inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full
                  bg-[#D4A237]/15 px-1 text-[10px] font-bold tabular-nums text-[#D4A237]
                  ring-1 ring-[#D4A237]/25"
              >
                {item.count > 99 ? "99+" : item.count}
              </span>
            ) : (
              <kbd className="sb-fade text-[10px] font-medium text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100">
                {mod}
                {idx + 1}
              </kbd>
            )}
          </>
        )}
        {/* pulse dot when a download is live and labels are hidden */}
        {sidebarCollapsed && item.href === "/download" && download && (
          <span className="sb-pulse absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#D4A237]" />
        )}
      </Link>
    );
  };

  return (
    <aside
      data-sidebar
      className={`relative flex h-full shrink-0 select-none flex-col overflow-hidden
        border-r border-white/[0.06] bg-gradient-to-b from-[#0d0d13] to-[#09090e]
        transition-[width] duration-200 ease-out motion-reduce:transition-none
        ${sidebarCollapsed ? "w-16" : "w-52"}`}
    >
      {/* ambient gold wash — keeps the rail from reading as a dead slab */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(140%_45%_at_0%_0%,rgba(212,162,55,0.055),transparent_55%)]"
      />

      {/* macOS: keep the signal lights clear, give the window a drag strip */}
      {isMac && (
        <div
          aria-hidden
          className="shrink-0"
          style={{ ...DRAG, height: MAC_TRAFFIC_CLEARANCE }}
        />
      )}

      {/* ── Collapse toggle + brand (also a drag region) ── */}
      <header
        className="relative flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-2.5"
        style={DRAG}
      >
        <button
          onClick={toggleSidebarCollapsed}
          style={NO_DRAG}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-keyshortcuts={`${mod}B`}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500
            transition-all hover:bg-white/[0.06] hover:text-zinc-200 active:scale-95"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
        {!sidebarCollapsed && (
          <div className="sb-fade flex min-w-0 items-center gap-2">
            <img
              src="/logo.png"
              alt="FilmSnaps"
              draggable={false}
              className="h-6 w-6 shrink-0 rounded-[7px] object-cover shadow-[0_2px_12px_rgba(212,162,55,0.25)]"
            />
            <span
              className="truncate text-[15px] font-bold tracking-tight text-[#F4F4F5]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              FilmSnaps
            </span>
          </div>
        )}
      </header>

      {/* ── Nav ── */}
      <nav
        aria-label="Primary"
        className="sb-scroll relative flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 pt-2"
      >
        {/* sliding active pill — measured from the live DOM, glides between routes */}
        <span
          aria-hidden
          className={`pointer-events-none absolute left-2 right-2 z-0 rounded-lg
            bg-[#D4A237]/[0.09] shadow-[0_1px_6px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-[#D4A237]/[0.12]
            transition-[top,height,opacity] duration-300 ease-[cubic-bezier(.3,.9,.3,1)]
            ${indicator ? "opacity-100" : "opacity-0"}`}
          style={
            indicator
              ? { top: indicator.top, height: indicator.height }
              : undefined
          }
        >
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#D4A237] shadow-[0_0_10px_rgba(212,162,55,0.7)]" />
        </span>

        {/* Search — ⌘K, the desktop command-palette anchor */}
        <button
          onClick={openSearch}
          onMouseEnter={(e) => showTip("Search", `${mod}K`, e.currentTarget)}
          onFocus={(e) => showTip("Search", `${mod}K`, e.currentTarget)}
          onMouseLeave={hideTip}
          onBlur={hideTip}
          aria-keyshortcuts={`${mod}K`}
          className={`group relative z-[1] mb-1 flex w-full items-center gap-3 rounded-lg outline-none
            text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200
            focus-visible:ring-2 focus-visible:ring-[#D4A237]/50
            ${sidebarCollapsed ? "justify-center px-2 py-2" : "px-2.5 py-2"}`}
        >
          <Search
            size={18}
            strokeWidth={1.8}
            className="shrink-0 transition-transform duration-150 group-hover:scale-110"
          />
          {!sidebarCollapsed && (
            <>
              <span className="sb-fade flex-1 truncate text-left text-[13px] font-medium">
                Search
              </span>
              <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-px text-[10px] font-medium text-zinc-500">
                {mod}K
              </kbd>
            </>
          )}
        </button>

        {groups.map((group, gi) => (
          <div key={group.label}>
            {sidebarCollapsed ? (
              gi > 0 && <div className="mx-2.5 my-2 h-px bg-white/[0.06]" />
            ) : (
              <p className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) =>
                renderRow(
                  item,
                  flat.findIndex((f) => f.href === item.href),
                ),
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Live download meter (fed via IPC from the main process) ── */}
      {download && !sidebarCollapsed && (
        <div className="sb-fade relative mx-2 mb-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2.5">
          <div className="flex items-center gap-2">
            <Download size={13} className="sb-pulse shrink-0 text-[#D4A237]" />
            <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-300">
              {download.label}
            </p>
            <span className="text-[10px] tabular-nums text-zinc-500">
              {pct}%
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="sb-stripes h-full rounded-full bg-[#D4A237] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {download.speed && (
            <p className="mt-1 text-[10px] tabular-nums text-zinc-600">
              {download.speed}
            </p>
          )}
        </div>
      )}
      {download && sidebarCollapsed && (
        <div className="relative mx-3 mb-2 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full bg-[#D4A237] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* ── Footer: legal links ── */}
      {!sidebarCollapsed && (
        <div className="relative border-t border-white/[0.06] px-2.5 py-2">
          <Link
            href="/legal"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
          >
            <ScrollText size={14} className="shrink-0" />
            Legal & DMCA
          </Link>
          <Link
            href="/privacy"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
          >
            <ScrollText size={14} className="shrink-0" />
            Privacy Policy
          </Link>
          <Link
            href="/how-it-works"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
          >
            <ScrollText size={14} className="shrink-0" />
            How Content Works
          </Link>
        </div>
      )}

      {/* ── Footer: account ── */}
      <div className="relative border-t border-white/[0.06] p-2">
        {user ? (
          <DropdownMenu onOpenChange={setAcctOpen}>
            <DropdownMenuTrigger asChild>
              <button
                onMouseEnter={(e) =>
                  showTip(user.email ?? "Account", undefined, e.currentTarget)
                }
                onMouseLeave={hideTip}
                className={`group flex w-full items-center gap-2.5 rounded-lg py-2 outline-none
                  text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200
                  focus-visible:ring-2 focus-visible:ring-[#D4A237]/50
                  ${sidebarCollapsed ? "justify-center px-0" : "px-2.5"}`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full
                  bg-[#D4A237]/15 text-xs font-black text-[#D4A237] ring-1 ring-[#D4A237]/20"
                >
                  {user.email?.charAt(0).toUpperCase() || "U"}
                </span>
                {!sidebarCollapsed && (
                  <>
                    <span className="sb-fade min-w-0 flex-1 text-left">
                      <span className="block truncate text-[12.5px] font-medium text-zinc-300 group-hover:text-zinc-100">
                        {user.email}
                      </span>
                      <span className="block text-[10.5px] text-zinc-600">
                        Account
                      </span>
                    </span>
                    <ChevronRight
                      size={14}
                      className={`shrink-0 text-zinc-600 transition-transform duration-200
                        ${acctOpen ? "-rotate-90" : "rotate-90"}`}
                    />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-60"
            >
              <div className="border-b border-white/[0.06] px-3 py-2.5">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.email}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Signed in to FilmSnaps
                </p>
              </div>
              <div className="border-b border-white/[0.06] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Shortcuts
                </p>
                <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                  <p className="flex justify-between">
                    <span>Toggle sidebar</span>
                    <kbd>{mod}B</kbd>
                  </p>
                  <p className="flex justify-between">
                    <span>Search</span>
                    <kbd>{mod}K</kbd>
                  </p>
                  <p className="flex justify-between">
                    <span>Jump to section</span>
                    <kbd>{mod}1–6</kbd>
                  </p>
                </div>
              </div>
              <div className="py-1">
                <DropdownMenuItem
                  onClick={() => signOut()}
                  className="text-sm text-red-400 focus:text-red-400"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Link
            href="/auth"
            onMouseEnter={(e) => showTip("Sign In", undefined, e.currentTarget)}
            onMouseLeave={hideTip}
            className={`group flex items-center gap-3 rounded-lg py-2 text-[13px] font-medium
              text-[#D4A237] transition-all hover:bg-[#D4A237]/10
              ${sidebarCollapsed ? "justify-center px-0" : "px-2.5"}`}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full
              bg-[#D4A237]/15 ring-1 ring-[#D4A237]/20 transition-transform group-hover:scale-105"
            >
              <LogIn size={14} className="text-[#D4A237]" />
            </span>
            {!sidebarCollapsed && <span className="sb-fade">Sign In</span>}
          </Link>
        )}
      </div>

      {/* collapsed-mode tooltip — fixed-positioned so the nav's scroll container can't clip it */}
      {sidebarCollapsed && tip && (
        <div
          role="tooltip"
          className="sb-fade pointer-events-none fixed z-50 flex -translate-y-1/2 items-center gap-1.5
            rounded-md border border-white/10 bg-[#16161d] px-2 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
          style={{ top: tip.top, left: "calc(4rem + 10px)" }}
        >
          <span className="text-xs font-medium text-zinc-200">{tip.label}</span>
          {tip.hint && (
            <kbd className="text-[10px] text-zinc-500">{tip.hint}</kbd>
          )}
        </div>
      )}

      {/* scoped motion + chrome scrollbar styles */}
      <style>{`
        [data-sidebar] .sb-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.12) transparent; }
        [data-sidebar] .sb-scroll::-webkit-scrollbar { width: 8px; }
        [data-sidebar] .sb-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 8px; }
        [data-sidebar] .sb-scroll:hover::-webkit-scrollbar-thumb { background: rgba(255,255,255,.10); }
        @keyframes sb-fade { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
        @keyframes sb-pop { 0% { transform: scale(.5); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
        @keyframes sb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
        @keyframes sb-stripes { from { background-position: 0 0; } to { background-position: 24px 0; } }
        [data-sidebar] .sb-fade { animation: sb-fade .28s cubic-bezier(.2,.8,.2,1) both; }
        [data-sidebar] .sb-pop { animation: sb-pop .25s ease both; }
        [data-sidebar] .sb-pulse { animation: sb-pulse 1.6s ease-in-out infinite; }
        [data-sidebar] .sb-stripes {
          background-image: linear-gradient(45deg, rgba(255,255,255,.22) 25%, transparent 25%,
            transparent 50%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.22) 75%, transparent 75%, transparent);
          background-size: 24px 24px;
          animation: sb-stripes .8s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-sidebar] .sb-fade, [data-sidebar] .sb-pop,
          [data-sidebar] .sb-pulse, [data-sidebar] .sb-stripes { animation: none !important; }
        }
      `}</style>
    </aside>
  );
}
