/**
 * LegalPageShell — shared layout for the static legal pages
 * (/legal, /privacy, /how-it-works).
 *
 * Mirrors the /versions page structure: the page owns a website header
 * (logo + Home link) wrapped in DesktopGate so it's hidden inside the
 * Electron shell (GlobalTopBar/Sidebar provide the chrome there), with the
 * content in a max-w-3xl column and the LegalFooter below.
 */

import React from "react";
import Link from "next/link";
import { DesktopGate } from "@/components/desktop/DesktopGate";
import { LegalFooter } from "./LegalFooter";

interface LegalPageShellProps {
  /** Page title shown in the header + h1. */
  title: string;
  /** Short subtitle under the h1. */
  subtitle?: string;
  /** Optional icon node shown above the h1. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function LegalPageShell({
  title,
  subtitle,
  icon,
  children,
}: LegalPageShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav — hidden inside the desktop shell (GlobalTopBar provides chrome) */}
      <DesktopGate>
        <header className="border-b border-border">
          <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="text-foreground font-bold text-lg">
              FilmSnaps
            </Link>
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              ← Back to Home
            </Link>
          </div>
        </header>
      </DesktopGate>

      <main className="max-w-3xl mx-auto px-4 pt-12 pb-16">
        {/* Title */}
        <div className="text-center mb-10">
          {icon && <div className="mx-auto mb-4">{icon}</div>}
          <h1
            className="text-3xl font-bold text-foreground mb-2"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          )}
        </div>

        {children}
      </main>

      <LegalFooter />
    </div>
  );
}
