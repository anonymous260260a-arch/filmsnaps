/**
 * InfoZone — 60/40 two-column grid below the video zone.
 *
 * Movies: left column = metadata, right column = "More Like This" grid
 * TV:     left column = metadata (minimal — just title/rating/genres),
 *         right column = EpisodeRail (same horizontal carousel as web app)
 */

"use client";

import React from "react";
import { EpisodeRail } from "@/components/player/EpisodeRail";
import { MetadataPanel } from "./MetadataPanel";
import { RelatedPanel } from "./RelatedPanel";

interface InfoZoneProps {
  /** Media type for branching episode vs related content */
  plat: "movie" | "tv";
  /** TMDB metadata object */
  initialMeta: any;
  /** Season data (TV only) */
  seasonData: any;
  /** Available seasons array from TMDB (TV only) */
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  /** TMDB content id for related content lookup */
  contentid: string;
  /** Called when season changes (TV only) */
  onSeasonChange?: (season: number) => void;
}

export function InfoZone({
  plat,
  initialMeta,
  seasonData,
  seasons,
  contentid,
  onSeasonChange,
}: InfoZoneProps) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-2">
      {plat === "tv" ? (
        /* ── TV: single column, just the episode rail ── */
        <div className="w-full">
          <EpisodeRail
            seasonData={seasonData}
            seasons={seasons}
            onSeasonChange={onSeasonChange ?? (() => {})}
          />
        </div>
      ) : (
        /* ── Movie: 60/40 grid ── */
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-8">
          <MetadataPanel initialMeta={initialMeta} plat={plat} />
          <RelatedPanel contentid={contentid} initialMeta={initialMeta} />
        </div>
      )}
    </div>
  );
}
