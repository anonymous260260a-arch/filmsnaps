/**
 * DownloadButton — entry point on movie/TV detail pages for offline downloads.
 *
 * Opens a small source picker with falix listed as the PRIMARY source
 * (direct HEVC files we control end-to-end) and nxsha as the SECONDARY
 * fallback, routing to their respective download pages. The DownloadBadge
 * next to it remains the live "downloads in progress" indicator; this button
 * is how downloads get started.
 */

"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, FileVideo, Server } from "lucide-react";

interface DownloadButtonProps {
  tmdbId: string | number;
  mediaType: "movie" | "tv";
}

export default function DownloadButton({
  tmdbId,
  mediaType,
}: DownloadButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const nxshaHref = `/download/nxsha?type=${mediaType}&id=${tmdbId}`;
  const falixHref = `/download/falix?type=${mediaType}&id=${tmdbId}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-white/[0.06] border border-white/[0.08] transition-colors"
      >
        <Download size={14} />
        Download
        <ChevronDown
          size={13}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-50 top-full left-0 mt-2 w-60 rounded-xl bg-[#141417] border border-white/[0.08] shadow-[0_16px_48px_rgba(0,0,0,0.6)] overflow-hidden"
        >
          {/* Falix — primary source (direct files, first in the list). */}
          <Link
            href={falixHref}
            onClick={() => setOpen(false)}
            className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.05] transition-colors"
          >
            <FileVideo size={15} className="text-[#D4A237] mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold">Falix</span>
                <span className="rounded-full border border-[#D4A237]/30 bg-[#D4A237]/[0.08] px-1.5 py-px text-[11px] font-medium leading-tight text-[#D4A237]">
                  Primary
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Direct HEVC files · bulk seasons
              </span>
            </span>
          </Link>
          <div className="h-px bg-white/[0.06]" />
          {/* Nxsha — secondary fallback (aggregated multi-server links). */}
          <Link
            href={nxshaHref}
            onClick={() => setOpen(false)}
            className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.05] transition-colors"
          >
            <Server size={15} className="text-faint mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold">Nxsha</span>
                <span className="rounded-full border border-white/[0.08] px-1.5 py-px text-[11px] leading-tight text-faint">
                  Secondary
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Multi-server direct links
              </span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
