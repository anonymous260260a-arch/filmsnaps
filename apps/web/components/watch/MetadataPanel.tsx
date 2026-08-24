/**
 * MetadataPanel — left column of the info zone.
 *
 * Shows: title, badges (year/rating/type), synopsis with "Read more",
 * genre tags, and cast/crew.
 */

"use client";

import React, { useState, useEffect, useRef } from "react";

interface MetadataPanelProps {
  /** TMDB metadata object */
  initialMeta: any;
  /** Media type */
  plat: "movie" | "tv";
}

export function MetadataPanel({ initialMeta, plat }: MetadataPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const synopsisRef = useRef<HTMLParagraphElement>(null);

  const title = initialMeta?.title || initialMeta?.name || "";
  const year = (
    initialMeta?.release_date ||
    initialMeta?.first_air_date ||
    ""
  ).slice(0, 4);
  const rating = initialMeta?.vote_average ?? 0;
  const genres = initialMeta?.genres ?? [];
  const overview = initialMeta?.overview || "";
  const cast = initialMeta?.credits?.cast ?? [];
  const director = initialMeta?.credits?.crew?.find(
    (c: any) => c.job === "Director",
  );

  // Detect if synopsis overflows the 3-line clamp
  useEffect(() => {
    const el = synopsisRef.current;
    if (el) {
      setIsOverflowing(el.scrollHeight > el.clientHeight);
    }
  }, [overview]);

  return (
    <div className="space-y-5">
      {/* Title + badges */}
      <div>
        <h2
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#D4A237]">
            {plat === "tv" ? "Series" : "Film"}
          </span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span className="text-xs text-zinc-500">{year}</span>
          {rating > 0 && (
            <>
              <span className="w-1 h-1 rounded-full bg-zinc-700" />
              <span className="text-xs text-[#D4A237]">
                ★ {rating.toFixed(1)}
              </span>
            </>
          )}
          {initialMeta?.episode_run_time?.[0] && plat === "tv" && (
            <>
              <span className="w-1 h-1 rounded-full bg-zinc-700" />
              <span className="text-xs text-zinc-500">
                {initialMeta.episode_run_time[0]}m
              </span>
            </>
          )}
          {initialMeta?.runtime && plat === "movie" && (
            <>
              <span className="w-1 h-1 rounded-full bg-zinc-700" />
              <span className="text-xs text-zinc-500">
                {Math.floor(initialMeta.runtime / 60)}h{" "}
                {initialMeta.runtime % 60}m
              </span>
            </>
          )}
        </div>
      </div>

      {/* Synopsis with Read more */}
      {overview && (
        <div>
          <p
            ref={synopsisRef}
            className={`text-sm text-zinc-400 leading-relaxed ${
              expanded ? "" : "line-clamp-3"
            }`}
          >
            {overview}
          </p>
          {isOverflowing && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-[#D4A237] mt-1 hover:underline font-medium"
            >
              {expanded ? "Show less" : "Read more ↓"}
            </button>
          )}
        </div>
      )}

      {/* Genre tags */}
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {genres.map((g: any) => (
            <span
              key={g.id}
              className="px-2.5 py-1 rounded-full bg-[#0E0E11] border border-[#222226]
                text-[11px] text-zinc-400 font-medium"
            >
              {g.name}
            </span>
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-[#222226]" />

      {/* Cast & Crew */}
      <div className="space-y-3">
        {cast.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.15em] mb-2">
              Cast
            </h3>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {cast.slice(0, 8).map((member: any) => (
                <span key={member.id} className="text-xs text-zinc-400">
                  {member.name}
                  {member.character && (
                    <span className="text-zinc-600">
                      {" "}
                      as {member.character}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {director && (
          <div>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.15em] mb-1">
              Director
            </h3>
            <span className="text-xs text-zinc-400">{director.name}</span>
          </div>
        )}

        {initialMeta?.created_by?.length > 0 && plat === "tv" && (
          <div>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.15em] mb-1">
              Created by
            </h3>
            <span className="text-xs text-zinc-400">
              {initialMeta.created_by.map((c: any) => c.name).join(", ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
