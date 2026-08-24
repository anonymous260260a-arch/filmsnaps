/**
 * PageShell — standard container for full-screen utility pages.
 *
 * Implements the expert spacing verdict (docs/top-bar-spacing-expert-consultation.md):
 * the top bar is a fixed h-16 translucent glass overlay, so every page must
 * clear it explicitly. Utility pages start at pt-24 (96px = 64px bar + one 32px
 * editorial gutter); pages whose backdrop hero bleeds under the glass use
 * variant="hero" (pt-32) so content sits below the blur interference zone.
 * Bottom rhythm is pb-24; gutters are px-4 sm:px-6 md:px-12.
 *
 * Max-width classes live in a literal map so Tailwind's JIT compiler sees
 * them — a dynamic `max-w-${name}` string would be purged from production CSS.
 *
 * Desktop note: inside the Electron shell (DesktopAppShell) the top bar is
 * in-flow rather than overlaying, so globals.css remaps these paddings via
 * the .page-shell / .page-shell-hero marker classes to an editorial gutter.
 */

import React from "react";

interface PageShellProps {
  children: React.ReactNode;
  /** Content max-width (Tailwind breakpoint name). Defaults to "5xl". */
  maxWidth?: "2xl" | "3xl" | "4xl" | "5xl";
  /** "hero" adds clearance for backdrop images bleeding under the glass bar. */
  variant?: "default" | "hero";
  /** Append the pb-24 bottom rhythm. Defaults to true. */
  bottomPadding?: boolean;
  /** Extra classes merged onto the <main> (e.g. "relative" over hero backdrops). */
  className?: string;
}

const MAX_WIDTH: Record<NonNullable<PageShellProps["maxWidth"]>, string> = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
};

export function PageShell({
  children,
  maxWidth = "5xl",
  variant = "default",
  bottomPadding = true,
  className,
}: PageShellProps) {
  const topPad = variant === "hero" ? "pt-32" : "pt-24";
  // Marker classes let globals.css remap the top offset inside the desktop
  // shell (in-flow GlobalTopBar) without touching other <main> elements.
  const marker =
    variant === "hero" ? "page-shell page-shell-hero" : "page-shell";
  return (
    <main
      className={[
        marker,
        "mx-auto w-full px-4 sm:px-6 md:px-12",
        topPad,
        bottomPadding ? "pb-24" : "",
        MAX_WIDTH[maxWidth],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </main>
  );
}

export default PageShell;
