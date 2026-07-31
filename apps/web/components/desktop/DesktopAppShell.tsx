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
import { useChromeStore } from "./chrome-store";
import { GlobalTopBar } from "./GlobalTopBar";
import { Sidebar } from "./Sidebar";
import { useIsDesktop } from "@/hooks/useIsDesktop";

export function DesktopAppShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const isDesktopVp = useIsDesktop();
  const { immersive } = useChromeStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isElectron =
    typeof window !== "undefined" && window.electronAPI?.isDesktop === true;

  // Web browser + SSR: render pages untouched (website keeps its own Header).
  if (!mounted || !isElectron) {
    return <>{children}</>;
  }

  return (
    <div className="desktop-shell fixed inset-0 z-0 flex flex-col bg-background">
      <GlobalTopBar />
      <div className="flex flex-1 overflow-hidden">
        {isDesktopVp && !immersive && <Sidebar />}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
