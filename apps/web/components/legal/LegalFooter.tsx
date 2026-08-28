/**
 * LegalFooter — site-wide legal link row for the website.
 *
 * Wrapped in DesktopGate so it renders only in the browser: inside the
 * Electron shell the Sidebar already shows the legal links.
 */

import Link from "next/link";
import { DesktopGate } from "@/components/desktop/DesktopGate";

const LINKS = [
  { href: "/legal", label: "Legal & DMCA" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/transparency", label: "Transparency & Security" },
];

export function LegalFooter() {
  return (
    <DesktopGate>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-8">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </footer>
    </DesktopGate>
  );
}
