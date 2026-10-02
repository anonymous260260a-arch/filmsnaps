"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Film,
  HelpCircle,
  List,
  Loader2,
  PlayCircle,
  XCircle,
} from "lucide-react";
import { HubEpisodesPane } from "./HubEpisodesPane";
import { groupLinkSections, type StreamLink } from "./StreamPickerSheet";
import { useSource, type SourceState } from "./SourceContext";
import { parseLinkLanguage, type ProbeOutcome } from "@/lib/probeStream";

type HubTab = "episodes" | "sources";

interface PlayerHubProps {
  plat: "movie" | "tv";
  seasonData: {
    episodes?: Array<{
      id: number;
      episode_number: number;
      name?: string;
      overview?: string;
      still_path?: string | null;
      runtime?: number;
      air_date?: string;
    }>;
  } | null;
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  onSeasonChange: (season: number) => void;
  /** TMDB show id — feeds per-episode watch-progress bars (mobile parity). */
  tvId?: string | null;
}

const TAB_META: Record<HubTab, { label: string; Icon: typeof List }> = {
  episodes: { label: "Episodes", Icon: List },
  sources: { label: "Sources", Icon: Film },
};

const LANG_CHIP_LABELS: Record<string, string> = {
  hindi: "Hindi",
  english: "English",
  multi: "Multi",
};

/**
 * Language chips for a source row — direct port of mobile's langChipsOf:
 * upstream-stated spoken language → anime sub/dub tag → name sniff
 * (Multi / Hindi / English) → moviebox "Original Audio".
 */
function langChipsOf(link: StreamLink): string[] {
  const chips: string[] = [];
  const meta = link._meta as
    | (NonNullable<StreamLink["_meta"]> & {
        audioLanguage?: string;
        providerId?: string;
      })
    | undefined;
  const spoken = (meta?.audioLanguage ?? "").trim();
  if (spoken) chips.push(spoken.charAt(0).toUpperCase() + spoken.slice(1));
  const audio = (meta?.audio ?? "").toLowerCase();
  if (audio === "dub" || audio === "sub")
    chips.push(audio === "dub" ? "Dub" : "Sub");
  if (chips.length === 0) {
    if (meta?.providerId === "moviebox") chips.push("Original Audio");
    else {
      const lang = parseLinkLanguage(link.name);
      if (lang !== "unknown") chips.push(LANG_CHIP_LABELS[lang] ?? lang);
    }
  }
  return chips;
}

/**
 * Below-player hub for the <1280px watch layout.
 *
 * Direct port of mobile's PlayerHub (apps/mobile/components/player/
 * PlayerHub.tsx): one rounded card, segmented pill tabs, mobile-clean
 * episode cards and source rows. Deliberate differences from mobile:
 *   - no Server tab (servers are picked in the page header)
 *   - no collapse chevron (the web page scrolls instead of living in a
 *     locked viewport)
 *   - no Sources header strip (mobile's pane is rows only)
 *
 * Renders nothing when no tab is available (a movie on an embed provider has
 * neither episodes nor a source list), so the grid cell doesn't reserve space
 * for an empty card.
 */
export function PlayerHub({
  plat,
  seasonData,
  seasons,
  onSeasonChange,
  tvId,
}: PlayerHubProps) {
  const source = useSource();

  const tabs = useMemo(() => {
    const list: HubTab[] = [];
    if (plat === "tv") list.push("episodes");
    if (source && source.links.length > 0) list.push("sources");
    return list;
  }, [plat, source]);

  const [tab, setTab] = useState<HubTab | null>(null);

  // Fall back to the first available tab whenever the current one disappears
  // (direct ↔ embed provider switch) and KEEP that fallback, so returning to
  // a direct provider lands on the default rather than a remembered choice.
  const active = tab && tabs.includes(tab) ? tab : (tabs[0] ?? null);
  useEffect(() => {
    if (tab !== active) setTab(active);
  }, [tab, active]);

  if (active === null) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-white/[0.06] bg-[#141414]">
        {/* Segmented pill tabs (mobile: icon + label, gold-tint active) */}
        <div
          role="tablist"
          className="flex shrink-0 items-center gap-1.5 px-3 pt-2.5"
        >
          {tabs.map((t) => {
            const { label, Icon } = TAB_META[t];
            const selected = active === t;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`hub-panel-${t}`}
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold transition-colors ${
                  selected
                    ? "bg-[#D4A237]/20 text-[#D4A237]"
                    : "text-[#52525B] hover:bg-white/[0.04] hover:text-zinc-300"
                }`}
              >
                <Icon size={15} className="shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 h-px shrink-0 bg-[#27272A]" />

        <div
          id={`hub-panel-${active}`}
          role="tabpanel"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {active === "episodes" ? (
            <HubEpisodesPane
              seasonData={seasonData}
              seasons={seasons}
              onSeasonChange={onSeasonChange}
              tvId={tvId}
            />
          ) : (
            <SourcesPane source={source!} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBits({ outcome }: { outcome: ProbeOutcome | undefined }) {
  if (!outcome) {
    return (
      <>
        <Loader2 size={12} className="shrink-0 animate-spin text-[#52525B]" />
        <span className="text-[11px] text-[#52525B]">Checking…</span>
      </>
    );
  }
  if (outcome === "valid") {
    return (
      <>
        <CheckCircle2 size={12} className="shrink-0 text-[#D4A237]" />
        <span className="text-[11px] text-[#52525B]">Verified</span>
      </>
    );
  }
  if (outcome === "dead") {
    return (
      <>
        <XCircle size={12} className="shrink-0 text-[#ef4444]" />
        <span className="text-[11px] text-[#52525B]">Failed</span>
      </>
    );
  }
  return (
    <>
      <HelpCircle size={12} className="shrink-0 text-[#52525B]" />
      <span className="text-[11px] text-[#52525B]">Unverified</span>
    </>
  );
}

function SourcesPane({ source }: { source: SourceState }) {
  const { sections, deadSection } = useMemo(
    () =>
      groupLinkSections(source.links, source.statuses, "all", source.rankById),
    [source.links, source.statuses, source.rankById],
  );

  // Flat mobile-style list: alive links in auto-pick order (language groups
  // preserved), dead ones last — no section headers, no header strip.
  const rows = useMemo(
    () => [...sections.flatMap((s) => s.items), ...deadSection],
    [sections, deadSection],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-10">
          <Film size={22} className="text-[#52525B]" />
          <span className="text-xs text-[#A1A1AA]">No sources available</span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {rows.map(({ link, index }) => {
            const isActive = index === source.activeIndex;
            const isRecommended = index === source.recommendedIndex;
            const isLastUsed = index === source.lastUsedIndex;
            const outcome = source.statuses?.get(index);
            const chips = langChipsOf(link);

            return (
              <button
                key={link.id}
                type="button"
                onClick={() => {
                  if (index !== source.activeIndex) source.select(index);
                }}
                className={`mb-2 flex w-full items-center gap-2.5 rounded-[14px] border p-3 text-left transition-colors ${
                  isActive
                    ? "border-[#D4A237]/40 bg-[#D4A237]/[0.08]"
                    : "border-white/[0.06] bg-[#0E0E11] hover:border-white/[0.14] hover:bg-white/[0.03]"
                }`}
              >
                {/* Index badge (mobile: circular icon slot) */}
                <span
                  className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full ${
                    isActive ? "bg-[#D4A237]/20" : "bg-[#222226]"
                  }`}
                >
                  <span
                    className={`text-[13px] font-extrabold tabular-nums ${
                      isActive ? "text-[#D4A237]" : "text-zinc-400"
                    }`}
                  >
                    {index + 1}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`truncate text-sm font-bold ${
                        isActive ? "text-[#D4A237]" : "text-zinc-100"
                      }`}
                    >
                      {link.quality || "Source"}
                    </span>
                    {isRecommended && !isActive && (
                      <span className="shrink-0 rounded-full bg-[#D4A237]/20 px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[0.04em] text-[#D4A237]">
                        Best
                      </span>
                    )}
                    {isLastUsed && !isActive && !isRecommended && (
                      <span className="shrink-0 rounded-full bg-[#222226] px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[0.04em] text-[#52525B]">
                        Last used
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <StatusBits outcome={outcome} />
                    {chips.map((chip) => (
                      <span
                        key={chip}
                        className="rounded-full bg-[#222226] px-[7px] py-0.5 text-[10px] font-bold text-zinc-400"
                      >
                        {chip}
                      </span>
                    ))}
                  </span>
                </span>

                {isActive && (
                  <PlayCircle size={20} className="shrink-0 text-[#D4A237]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
