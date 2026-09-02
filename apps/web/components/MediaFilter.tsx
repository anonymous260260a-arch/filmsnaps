"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Filter,
  Search,
  RotateCcw,
  Star,
  Calendar,
  Languages,
  ArrowUpDown,
  X,
  Check,
  Sparkles,
  Film,
  SlidersHorizontal,
} from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Genre {
  id: number;
  name: string;
}

interface FilterProps {
  genres: Genre[];
  selectedGenres: number[];
  onGenreToggle: (id: number) => void;
  sortBy: string;
  onSortChange: (value: string) => void;
  yearRange: [number, number];
  onYearRangeChange: (range: [number, number]) => void;
  ratingRange: [number, number];
  onRatingRangeChange: (range: [number, number]) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  onReset: () => void;
  onApply: () => void;
}

const SORT_OPTIONS = [
  { value: "popularity.desc", label: "Trending Popularity", icon: Sparkles },
  { value: "vote_average.desc", label: "Top Rated", icon: Star },
  {
    value: "primary_release_date.desc",
    label: "Latest Releases",
    icon: Calendar,
  },
  {
    value: "primary_release_date.asc",
    label: "Vintage Collection",
    icon: Film,
  },
];

const TOP_LANGUAGES = [
  { value: "", label: "All Languages" },
  { value: "en", label: "English" },
  { value: "ko", label: "Korean" },
  { value: "ja", label: "Japanese" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "hi", label: "Hindi" },
  { value: "it", label: "Italian" },
];

const CURRENT_YEAR = new Date().getFullYear();

const YEAR_PRESETS: Array<{ label: string; range: [number, number] }> = [
  { label: "All Time", range: [1900, CURRENT_YEAR] },
  { label: "2020s", range: [2020, CURRENT_YEAR] },
  { label: "2010s", range: [2010, 2019] },
  { label: "2000s", range: [2000, 2009] },
  { label: "Classics", range: [1900, 1999] },
];

const RATING_PRESETS: Array<{ label: string; range: [number, number] }> = [
  { label: "All Ratings", range: [0, 10] },
  { label: "7.0+ ★", range: [7, 10] },
  { label: "8.0+ ★", range: [8, 10] },
];

export function MediaFilter({
  genres = [],
  selectedGenres = [],
  onGenreToggle,
  sortBy,
  onSortChange,
  yearRange,
  onYearRangeChange,
  ratingRange,
  onRatingRangeChange,
  language,
  onLanguageChange,
  onReset,
  onApply,
}: FilterProps) {
  const [genreSearch, setGenreSearch] = React.useState("");
  const [isOpen, setIsOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const modalRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll when open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Close on Escape key
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const filteredGenres = React.useMemo(() => {
    if (!genreSearch.trim()) return genres;
    return genres.filter((g) =>
      g.name.toLowerCase().includes(genreSearch.toLowerCase().trim()),
    );
  }, [genres, genreSearch]);

  const activeFilterCount = React.useMemo(() => {
    let count = 0;
    if (selectedGenres.length > 0) count++;
    if (sortBy && sortBy !== "popularity.desc") count++;
    if (yearRange[0] !== 1900 || yearRange[1] !== CURRENT_YEAR) count++;
    if (ratingRange[0] !== 0 || ratingRange[1] !== 10) count++;
    if (language && language.trim() !== "") count++;
    return count;
  }, [selectedGenres, sortBy, yearRange, ratingRange, language]);

  const isPresetActive = (
    current: [number, number],
    target: [number, number],
  ) => current[0] === target[0] && current[1] === target[1];

  const handleApply = () => {
    onApply();
    setIsOpen(false);
  };

  const handleReset = () => {
    onReset();
    setGenreSearch("");
  };

  const modalContent = isOpen ? (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === modalRef.current) setIsOpen(false);
      }}
    >
      <div className="relative flex flex-col w-full max-w-2xl max-h-[90vh] bg-[#0E0E12] border border-white/10 rounded-2xl shadow-[0_25px_70px_rgba(0,0,0,0.85)] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Ambient Top Glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-[#D4A237]/10 via-[#D4A237]/5 to-transparent"
        />

        {/* ── Header ── */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#121217]/60">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#D4A237]/15 border border-[#D4A237]/30 text-[#D4A237]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-white">
                  Refine Collection
                </h2>
                {activeFilterCount > 0 && (
                  <Badge className="bg-[#D4A237] text-black font-extrabold text-[11px] px-2 py-0.5 rounded-full border-none">
                    {activeFilterCount} Active
                  </Badge>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Filter titles by genre, year, rating, and language
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                title="Reset all filters"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            )}
            <button
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Body (Scrollable) ── */}
        <ScrollArea className="flex-1 px-6 py-5">
          <div className="space-y-7 pb-4">
            {/* 1. SORT BY */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <ArrowUpDown className="h-3.5 w-3.5 text-[#D4A237]" />
                <span>Sort Order</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SORT_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = sortBy === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => onSortChange(opt.value)}
                      className={cn(
                        "flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all text-xs font-medium gap-1.5",
                        active
                          ? "bg-[#D4A237]/15 border-[#D4A237] text-white shadow-[0_0_15px_rgba(212,162,55,0.15)]"
                          : "bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4",
                          active ? "text-[#D4A237]" : "text-zinc-500",
                        )}
                      />
                      <span className="truncate w-full">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-white/[0.06]" />

            {/* 2. GENRES */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  <Film className="h-3.5 w-3.5 text-[#D4A237]" />
                  <span>Genres</span>
                </div>
                {selectedGenres.length > 0 && (
                  <span className="text-xs font-semibold text-[#D4A237]">
                    {selectedGenres.length} Selected
                  </span>
                )}
              </div>

              {/* Genre Search Box */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search genres..."
                  value={genreSearch}
                  onChange={(e) => setGenreSearch(e.target.value)}
                  className="w-full h-10 pl-10 pr-9 bg-white/[0.04] border border-white/[0.08] rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4A237]/50 focus:ring-1 focus:ring-[#D4A237]/50 transition-colors"
                />
                {genreSearch && (
                  <button
                    onClick={() => setGenreSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Genre Pills */}
              <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto p-1 pr-2 custom-scrollbar">
                {filteredGenres.map((g) => {
                  const selected = selectedGenres.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      onClick={() => onGenreToggle(g.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 active:scale-95",
                        selected
                          ? "bg-[#D4A237] border-[#D4A237] text-black font-semibold shadow-[0_2px_10px_rgba(212,162,55,0.3)]"
                          : "bg-white/[0.03] border-white/[0.06] text-zinc-300 hover:bg-white/[0.08] hover:text-white",
                      )}
                    >
                      {selected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                      <span>{g.name}</span>
                    </button>
                  );
                })}
                {filteredGenres.length === 0 && (
                  <p className="text-xs text-zinc-500 py-3 text-center w-full">
                    No matching genres found
                  </p>
                )}
              </div>
            </div>

            <div className="h-px bg-white/[0.06]" />

            {/* 3. RELEASE YEAR */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  <Calendar className="h-3.5 w-3.5 text-[#D4A237]" />
                  <span>Release Year</span>
                </div>
                <div className="px-2.5 py-1 rounded-md bg-white/[0.05] border border-white/[0.08] text-xs font-mono text-white font-bold">
                  {yearRange[0]} — {yearRange[1]}
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap gap-1.5">
                {YEAR_PRESETS.map((preset) => {
                  const active = isPresetActive(yearRange, preset.range);
                  return (
                    <button
                      key={preset.label}
                      onClick={() => onYearRangeChange(preset.range)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors",
                        active
                          ? "bg-[#D4A237]/20 border-[#D4A237] text-[#D4A237]"
                          : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <Slider
                min={1900}
                max={CURRENT_YEAR}
                step={1}
                value={yearRange}
                onValueChange={(val) =>
                  onYearRangeChange(val as [number, number])
                }
                className="py-2"
              />
            </div>

            <div className="h-px bg-white/[0.06]" />

            {/* 4. TMDB RATING */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  <Star className="h-3.5 w-3.5 text-[#D4A237]" />
                  <span>TMDB Rating</span>
                </div>
                <div className="px-2.5 py-1 rounded-md bg-white/[0.05] border border-white/[0.08] text-xs font-mono text-[#D4A237] font-bold">
                  {ratingRange[0].toFixed(1)} ★ — {ratingRange[1].toFixed(1)} ★
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap gap-1.5">
                {RATING_PRESETS.map((preset) => {
                  const active = isPresetActive(ratingRange, preset.range);
                  return (
                    <button
                      key={preset.label}
                      onClick={() => onRatingRangeChange(preset.range)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors",
                        active
                          ? "bg-[#D4A237]/20 border-[#D4A237] text-[#D4A237]"
                          : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <Slider
                min={0}
                max={10}
                step={0.1}
                value={ratingRange}
                onValueChange={(val) =>
                  onRatingRangeChange(val as [number, number])
                }
                className="py-2"
              />
            </div>

            <div className="h-px bg-white/[0.06]" />

            {/* 5. ORIGINAL LANGUAGE */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Languages className="h-3.5 w-3.5 text-[#D4A237]" />
                <span>Original Language</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TOP_LANGUAGES.map((lang) => {
                  const active = (language || "") === lang.value;
                  return (
                    <button
                      key={lang.value || "all"}
                      onClick={() => onLanguageChange(lang.value)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                        active
                          ? "bg-[#D4A237] border-[#D4A237] text-black font-semibold shadow-[0_2px_10px_rgba(212,162,55,0.3)]"
                          : "bg-white/[0.03] border-white/[0.06] text-zinc-300 hover:bg-white/[0.08] hover:text-white",
                      )}
                    >
                      {lang.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* ── Footer Actions ── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/[0.08] bg-[#121217]/90">
          <button
            onClick={handleReset}
            className="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            Reset Filters
          </button>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-b from-[#E8BC4F] to-[#D4A237] text-black font-bold text-xs shadow-[0_4px_20px_rgba(212,162,55,0.35)] hover:brightness-105 active:scale-98 transition-all"
            >
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {/* ── Trigger Button ── */}
      <GlassButton
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="relative group overflow-hidden border-white/10 hover:border-white/20 transition-all"
      >
        <Filter className="mr-2 h-4 w-4 text-[#D4A237] transition-transform group-hover:rotate-180" />
        <span>Filters</span>
        {activeFilterCount > 0 && (
          <Badge className="ml-2 bg-[#D4A237] text-black font-bold px-1.5 py-0.5 rounded-full text-[10px] border-none">
            {activeFilterCount}
          </Badge>
        )}
      </GlassButton>

      {/* ── Portal Modal ── */}
      {mounted && modalContent && createPortal(modalContent, document.body)}
    </>
  );
}
