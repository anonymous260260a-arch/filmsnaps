"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, Menu, X, ArrowLeft, Download, Clock } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import {
  tmdbApi,
  getImageUrl,
  rankSearchResults,
  smartSearch,
} from "@/lib/tmdb";
import { useDebounce } from "@/hooks/useDebounce";
import { useQuery } from "@tanstack/react-query";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { savedMovies } = useWatchlist();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // Detect Electron desktop environment
  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI?.isDesktop) {
      setIsDesktop(true);
    }
  }, []);

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

  // Search suggestions
  const { data: searchResults } = useQuery({
    queryKey: ["header-search", debouncedQuery],
    queryFn: () => smartSearch(debouncedQuery),
    enabled: debouncedQuery.length > 1,
    staleTime: 30 * 1000,
    gcTime: 60 * 1000,
  });

  const suggestions = useMemo(() => {
    if (!searchResults?.results) return [];
    return rankSearchResults(searchResults.results, debouncedQuery, 6);
  }, [searchResults, debouncedQuery]);

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setMobileSearchOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when desktop search opens
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  // Close search on route change
  useEffect(() => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setSearchQuery("");
  }, [pathname]);

  // Close desktop search dropdown when clicking outside
  useEffect(() => {
    if (!searchOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(e.target as Node) &&
        searchBtnRef.current &&
        !searchBtnRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [searchOpen]);

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

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setSearchOpen(false);
      setMobileSearchOpen(false);
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
    }
  };

  const handleSuggestionClick = (item: any) => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setSearchQuery("");
    const type = item.media_type || "movie";
    router.push(`/${type}/${item.id}`);
  };

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

            {/* Search trigger (desktop) */}
            <button
              ref={searchBtnRef}
              onClick={openDesktopSearch}
              className="ml-2 flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] relative"
              aria-label="Open search"
            >
              <Search className="h-4 w-4" />
              <span className="hidden lg:inline">Search</span>
              <kbd className="hidden lg:inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground/60 bg-white/[0.04] rounded border border-white/[0.06]">
                ⌘K
              </kbd>

              {/* ── Desktop Search Dropdown ── */}
              {searchOpen && (
                <div
                  ref={searchDropdownRef}
                  className="fixed md:absolute md:top-full md:right-0 md:mt-2 md:w-[420px] md:rounded-2xl bg-[#0a0a0f]/90 backdrop-blur-2xl border border-white/[0.06] shadow-2xl overflow-hidden z-[60] animate-fade-in"
                  style={
                    {
                      // On mobile it's full screen, on desktop it's positioned below the button
                    }
                  }
                >
                  <form onSubmit={handleSearchSubmit} className="p-3">
                    <div className="relative flex items-center">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search movies & TV shows..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-11 pl-10 pr-4 rounded-xl bg-secondary/40 border border-white/[0.06] text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                      />
                    </div>
                  </form>

                  {searchQuery.length > 1 && (
                    <div className="pb-2">
                      {suggestions.length > 0 ? (
                        <>
                          <div className="px-3 pb-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">
                              Suggestions
                            </p>
                          </div>
                          {suggestions.map((item: any) => (
                            <button
                              key={`${item.media_type}-${item.id}`}
                              onClick={() => handleSuggestionClick(item)}
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-white/[0.04] transition-colors"
                            >
                              <div className="w-8 h-12 rounded-lg overflow-hidden bg-secondary/40 flex-shrink-0">
                                {(item.poster_path || item.poster) && (
                                  <img
                                    src={
                                      getImageUrl(
                                        item.poster_path || item.poster,
                                        "w92",
                                      ) || ""
                                    }
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-foreground truncate">
                                  {item.title || item.name}
                                </p>
                                <p className="text-xs text-muted-foreground capitalize">
                                  {item.media_type === "movie"
                                    ? "Movie"
                                    : "TV Show"}
                                  {item.release_date || item.first_air_date
                                    ? ` · ${(item.release_date || item.first_air_date).slice(0, 4)}`
                                    : ""}
                                </p>
                              </div>
                            </button>
                          ))}
                          <button
                            onClick={handleSearchSubmit}
                            className="w-full flex items-center justify-center gap-2 mt-1 px-3 py-2.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-xl transition-colors"
                          >
                            <Search className="h-3.5 w-3.5" />
                            See all results for &ldquo;{searchQuery}&rdquo;
                          </button>
                        </>
                      ) : (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                          No results found
                        </div>
                      )}
                    </div>
                  )}

                  {searchQuery.length <= 1 && (
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                      Start typing to search movies &amp; TV shows
                    </div>
                  )}
                </div>
              )}
            </button>
          </nav>

          {/* ── Mobile: Search + Menu buttons ── */}
          <div className="md:hidden flex items-center gap-1">
            {/* Mobile search overlay */}
            {mobileSearchOpen ? (
              <div className="fixed inset-0 z-50 bg-background/98 backdrop-blur-lg">
                <div className="flex items-center gap-2 px-4 h-16 border-b border-white/[0.04]">
                  <button
                    onClick={() => {
                      setMobileSearchOpen(false);
                      setSearchQuery("");
                    }}
                    className="p-1.5 -ml-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <form onSubmit={handleSearchSubmit} className="flex-1">
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search movies & TV shows..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl bg-secondary/30 border border-white/[0.06] text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                      autoFocus
                    />
                  </form>
                </div>

                <div className="overflow-y-auto max-h-[calc(100vh-4rem)] px-4 py-4">
                  {searchQuery.length > 1 && suggestions.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-3 px-1">
                        Suggestions
                      </p>
                      {suggestions.map((item: any) => (
                        <button
                          key={`${item.media_type}-${item.id}`}
                          onClick={() => handleSuggestionClick(item)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left hover:bg-white/[0.04] transition-colors"
                        >
                          <div className="w-10 h-14 rounded-lg overflow-hidden bg-secondary/40 flex-shrink-0">
                            {(item.poster_path || item.poster) && (
                              <img
                                src={
                                  getImageUrl(
                                    item.poster_path || item.poster,
                                    "w92",
                                  ) || ""
                                }
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {item.title || item.name}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {item.media_type === "movie"
                                ? "Movie"
                                : "TV Show"}
                              {item.release_date || item.first_air_date
                                ? ` · ${(item.release_date || item.first_air_date).slice(0, 4)}`
                                : ""}
                            </p>
                          </div>
                        </button>
                      ))}
                      <button
                        onClick={handleSearchSubmit}
                        className="w-full flex items-center justify-center gap-2 mt-3 px-4 py-3 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                      >
                        <Search className="h-4 w-4" />
                        See all results
                      </button>
                    </div>
                  )}
                  {searchQuery.length > 1 && suggestions.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-12">
                      No results found
                    </div>
                  )}
                  {searchQuery.length <= 1 && (
                    <div className="text-center text-sm text-muted-foreground py-12">
                      <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      Start typing to search
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => {
                    setMobileSearchOpen(true);
                    setMenuOpen(false);
                  }}
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
              </>
            )}
          </div>
        </div>
      </div>

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
