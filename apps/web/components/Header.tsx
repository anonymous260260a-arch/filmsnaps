"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Menu, X } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { ModeSplitToggle } from "@/components/ModeSplitToggle";
import { SearchPalette } from "@/components/desktop/SearchPalette";

export function Header() {
  const pathname = usePathname();
  const { savedMovies } = useWatchlist();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Lazy-init: synchronously detect Electron on first client render to avoid
  // the one-frame flash of the full website header on desktop.
  const [isDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!window.electronAPI?.isDesktop;
  });

  const navLinks = useMemo(
    () => [
      { href: "/", label: "Home" },
      { href: "/movie", label: "Movies" },
      { href: "/tv", label: "TV Shows" },
      { href: "/saved", label: "Saved", count: savedMovies?.length },
      { href: "/history", label: "History" },
      ...(!isDesktop ? [{ href: "/download", label: "Download" }] : []),
    ],
    [savedMovies?.length, isDesktop],
  );

  // Search suggestions live inside SearchPalette (both desktop and mobile
  // open the same command palette) — no duplicate header-side query.

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close search on route change
  useEffect(() => {
    setSearchOpen(false);
  }, [pathname]);

  // Disable body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  // ── Desktop shell takes over chrome ──
  // On Electron the global DesktopAppShell (sidebar + top bar) replaces
  // this website header entirely — including nav, search, and window chrome.
  // Keeping the Header mounted but returning null preserves all 8 mount
  // sites without editing them, and leaves the web build untouched.
  if (isDesktop) return null;

  const openDesktopSearch = () => {
    setSearchOpen(true);
    setMenuOpen(false);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/[0.04] transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ── Logo ── */}
          <Link
            href="/"
            className="flex items-center gap-2 group flex-shrink-0"
          >
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#D4A237]/10 group-hover:bg-[#D4A237]/20 transition-all duration-300 overflow-hidden">
              <img
                src="/logo.png"
                alt="FilmSnaps"
                className="h-7 w-7 object-contain"
              />
            </div>
            <span
              className="text-xl font-bold tracking-tight text-foreground"
              style={{ fontFamily: "var(--font-display)" }}
            >
              FilmSnaps
            </span>
          </Link>

          {/* ── Desktop Nav ── */}
          <nav className="hidden md:flex items-center space-x-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                  isActive(link.href)
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                }`}
              >
                {link.label}
                {link.count !== undefined && link.count > 0 && (
                  <span
                    suppressHydrationWarning
                    className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[11px] font-bold rounded-full bg-primary/20 text-primary"
                  >
                    {link.count > 99 ? "99+" : link.count}
                  </span>
                )}
              </Link>
            ))}

            {/* Search trigger (desktop) + Hard Mode Split toggle.
                The toggle is a SIBLING of the search button (not nested inside
                it) so clicking it switches mode without opening search. */}
            <div className="hidden lg:flex items-center gap-2">
              <button
                onClick={openDesktopSearch}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] relative"
                aria-label="Open search"
              >
                <Search className="h-4 w-4" />
                <span className="hidden lg:inline">Search</span>
                <kbd className="hidden lg:inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground/60 bg-white/[0.04] rounded border border-white/[0.06]">
                  ⌘K
                </kbd>
              </button>

              {/* Hard Mode Split toggle (web header) */}
              <span className="hidden lg:inline-flex items-center">
                <ModeSplitToggle />
              </span>
            </div>
          </nav>

          {/* ── Mobile: Search + Menu buttons ── */}
          <div className="md:hidden flex items-center gap-1">
            <button
              onClick={openDesktopSearch}
              className="p-2 rounded-xl hover:bg-white/[0.06] transition-all duration-200"
              aria-label="Open search"
            >
              <Search className="h-5 w-5 text-muted-foreground" />
            </button>
            <button
              className="p-2 rounded-xl hover:bg-white/[0.06] transition-all duration-200"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              {menuOpen ? (
                <X className="h-5 w-5 text-primary" />
              ) : (
                <Menu className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Search palette — portal to body, opened by the desktop
            ⌘K/⌘-button AND the mobile search button (web == desktop). ── */}
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />

      {/* ── Mobile Overlay ── */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          menuOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMenuOpen(false)}
      />

      {/* ── Mobile Drawer ── */}
      <div
        className={`fixed top-0 right-0 z-50 h-screen w-72 glass border-l border-white/[0.06] shadow-2xl transform transition-transform duration-300 ease-out ${
          menuOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <span className="text-xl font-bold tracking-tight text-foreground">
            FilmSnaps
          </span>
          <button
            onClick={() => setMenuOpen(false)}
            className="p-2 rounded-xl hover:bg-white/[0.06] transition"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <nav className="flex flex-col gap-1 mt-6 px-3">
          {/* Hard Mode Split — Movies / Anime (mobile-web had no visible
              toggle since the header one is lg:hidden; surface it here). */}
          <div className="px-3 pb-3">
            <ModeSplitToggle className="w-full [&>button]:flex-1" />
          </div>

          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={`flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                isActive(link.href)
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              }`}
            >
              {link.label}
              {link.count !== undefined && link.count > 0 && (
                <span
                  suppressHydrationWarning
                  className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 text-[11px] font-bold rounded-full bg-primary/20 text-primary"
                >
                  {link.count > 99 ? "99+" : link.count}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
