"use client";

import React, { useState } from "react";
import { Play } from "lucide-react";
import { VideoPlayer } from "@/components/VideoPlayer";

/**
 * LazyTrailer — click-to-play trailer embed.
 *
 * The YouTube iframe (and its whole network load) only mounts after the user
 * taps play; before that we show the video's own thumbnail with a play
 * affordance. This also keeps the desktop shell's document-level spinner
 * (did-start-loading) quiet while browsing detail pages — an eagerly-mounted
 * iframe is what used to drive the top loading bar.
 */
export function LazyTrailer({
  videoKey,
  title,
}: {
  videoKey: string;
  title?: string;
}) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return <VideoPlayer videoKey={videoKey} title={title} autoplay />;
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play trailer${title ? ` for ${title}` : ""}`}
      className="group relative w-full aspect-video overflow-hidden rounded-2xl bg-subtle shadow-xl ring-1 ring-white/[0.06]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${videoKey}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      <span className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-background shadow-[0_8px_24px_rgba(212,162,55,0.45)] transition-transform duration-200 group-hover:scale-110 group-active:scale-95">
          <Play size={22} fill="currentColor" className="ml-0.5" />
        </span>
        <span className="text-sm font-semibold text-foreground drop-shadow">
          Watch Trailer
        </span>
      </span>
    </button>
  );
}
