/**
 * DesktopAppShell — the native-feeling app chrome for the frameless
 * Electron window.
 *
 * Rendered once from the root layout. On web + during SSR it renders the
 * pages untouched (no chrome). On desktop it owns the window:
 *
 *   ┌────────────────────────────────────────────┐
 *   │ <GlobalTopBar />  (drag region, h-12)       │
 *   ├────────┬───────────────────────────────────┤
 *   │        │                                   │
 *   │ Sidebar│  <main> (this window scrolls)     │
 *   │        │                                   │
 *   └────────┴───────────────────────────────────┘
 *
 * The bar and sidebar are in-flow, so no page needs a top-offset —
 * `.desktop-shell main { padding-top: 0 }` (globals.css) neutralizes the
 * leftover website-header padding.
 *
 * Hydration guard mirrors WatchClient: SSR renders <>{children}</>, then
 * after mount (client-only) we flip to the shell when inside Electron.
 */

"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import {
  useChromeStore,
  toggleWatchNavDrawer,
  closeWatchNavDrawer,
} from "./chrome-store";
import { GlobalTopBar } from "./GlobalTopBar";
import { Sidebar } from "./Sidebar";
import { useIsDesktop } from "@/hooks/useIsDesktop";

export function DesktopAppShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const isDesktopVp = useIsDesktop();
  const { immersive, watchNavDrawerOpen } = useChromeStore();
  const pathname = usePathname();
  const isWatchPage = pathname?.startsWith("/watch");

  useEffect(() => {
    setMounted(true);
    // Couch-distance scaling (readability verdict Q3): rem utilities resolve
    // against the ROOT font-size, so the bump must land on <html>, not on a
    // shell div. Web/browser pages keep the default 16px root.
    if (
      typeof window !== "undefined" &&
      window.electronAPI?.isDesktop === true
    ) {
      document.documentElement.classList.add("fs-desktop");
    }
  }, []);

  // Close drawer on navigation (single source of truth in chrome-store)
  useEffect(() => {
    closeWatchNavDrawer();
  }, [pathname]);

  // Fullscreen playback (immersive): the OS window IS the screen — the page
  // must not scroll anywhere, and no scrollbar may be visible over the video.
  // Locks both the shell's content main (className below) and body-level
  // scroll (fixed children can still leave the body scrollable by a dead
  // margin — hiding the bar is not enough, wheel/keys must be dead too).
  useEffect(() => {
    if (!immersive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [immersive]);

  // Close on Escape key
  useEffect(() => {
    if (!watchNavDrawerOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWatchNavDrawer();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [watchNavDrawerOpen]);

  const isElectron =
    typeof window !== "undefined" && window.electronAPI?.isDesktop === true;

  // mpv video window: the /mpv-overlay route renders INSIDE the transparent
  // overlay window that hosts the mpv video HWND. It must render bare — the
  // app chrome (top bar, background) would paint over the video.
  if (isElectron && pathname === "/mpv-overlay") {
    return <>{children}</>;
  }

  // Web browser + SSR: render pages untouched (website keeps its own Header).
  if (!mounted || !isElectron) {
    return (
      <>
        {children}
        {/* Web Drawer Overlay (if toggled on web) */}
        {isWatchPage && watchNavDrawerOpen && (
          <div
            className="fixed inset-0 z-[99999] flex"
            onClick={() => closeWatchNavDrawer()}
          >
            <div className="absolute inset-0 bg-black/75 backdrop-blur-md animate-fade-in" />
            <div
              className="relative z-10 h-full w-[260px] bg-surface border-r border-white/[0.08] shadow-[20px_0_60px_rgba(0,0,0,0.9)] animate-in slide-in-from-left duration-200 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-3.5 border-b border-white/[0.07] flex items-center justify-between bg-elevated">
                <span className="text-xs font-semibold text-foreground">
                  Menu
                </span>
                <button
                  onClick={() => closeWatchNavDrawer()}
                  className="w-7 h-7 rounded-lg bg-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-white/[0.12] flex items-center justify-center transition-colors active:scale-95"
                  aria-label="Close menu"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <Sidebar />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    // NO z-index here: a z-indexed fixed root would create a stacking context
    // and pin EVERY overlay portaled to document.body (server sheet, search
    // palette, legal gate — z-[100]…z-[99999]) above the GlobalTopBar, hiding
    // the window controls. With z:auto the bar's own z-index competes at root
    // level and can sit above all of them (GlobalTopBar is z-[100000]).
    <div className="desktop-shell fixed inset-0 flex flex-col bg-background">
      <GlobalTopBar />
      <div className="flex flex-1 overflow-hidden">
        {isDesktopVp && !immersive && !isWatchPage && <Sidebar />}
        <main
          className={`flex-1 overflow-x-hidden bg-background ${
            immersive && isWatchPage
              ? "overflow-hidden" // fullscreen playback — no scroll, no scrollbar
              : "overflow-y-auto"
          }`}
        >
          {children}
        </main>
      </div>

      {/* ── Watch Page YouTube-Style Navigation Drawer Overlay (Electron) ── */}
      {isWatchPage && watchNavDrawerOpen && (
        <div
          className="fixed inset-0 z-[99999] flex"
          onClick={() => closeWatchNavDrawer()}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md animate-fade-in" />

          {/* Slide-in Sidebar Panel */}
          <div
            className="relative z-10 h-full w-[260px] bg-surface border-r border-white/[0.08] shadow-[20px_0_60px_rgba(0,0,0,0.9)] animate-in slide-in-from-left duration-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3.5 border-b border-white/[0.07] flex items-center justify-between bg-elevated">
              <span className="text-xs font-semibold text-foreground">
                Menu
              </span>
              <button
                onClick={() => closeWatchNavDrawer()}
                className="w-7 h-7 rounded-lg bg-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-white/[0.12] flex items-center justify-center transition-colors active:scale-95"
                aria-label="Close menu"
              >
                <X size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <Sidebar />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
