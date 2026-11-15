/**
 * DownloadButton — entry point on movie/TV detail pages for offline downloads.
 *
 * Opens a small source picker with falix listed as the PRIMARY source
 * (direct HEVC files we control end-to-end) and nxsha as the SECONDARY
 * fallback, routing to their respective download pages. The DownloadBadge
 * next to it remains the live "downloads in progress" indicator; this button
 * is how downloads get started.
 *
 * The picker anchors to the trigger's RIGHT edge (not left): on the phone
 * detail layout the trigger is the right-most element of its row, so a
 * left-anchored sheet hangs past the viewport's right edge.
 */

"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, FileVideo, Server } from "lucide-react";
import { cn } from "@/lib/utils";

interface DownloadButtonProps {
  tmdbId: string | number;
  mediaType: "movie" | "tv";
  /** Layout overrides for the trigger button (merged last, so they win). */
  buttonClassName?: string;
  /** Layout for the anchoring wrapper (e.g. flex-1 in a button row). The
   * sheet positions itself against this wrapper's right edge. */
  wrapperClassName?: string;
}

export default function DownloadButton({
  tmdbId,
  mediaType,
  buttonClassName,
  wrapperClassName,
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

  const hdhubHref = `/download/hdhub?type=${mediaType}&id=${tmdbId}`;
  const nxshaHref = `/download/nxsha?type=${mediaType}&id=${tmdbId}`;
  const falixHref = `/download/falix?type=${mediaType}&id=${tmdbId}`;

  const sources = [
    {
      href: hdhubHref,
      icon: FileVideo,
      iconClass: "text-primary",
      name: "HDHub",
      tag: "Primary",
      tagClass:
        "border-primary/30 bg-primary/[0.08] text-primary font-semibold",
      desc: "Direct CDN files · all qualities",
    },
    {
      href: falixHref,
      icon: FileVideo,
      iconClass: "text-faint",
      name: "Falix",
      tag: "Secondary",
      tagClass: "border-white/[0.08] text-faint",
      desc: "Direct HEVC files · bulk seasons",
    },
    {
      href: nxshaHref,
      icon: Server,
      iconClass: "text-faint",
      name: "Nxsha",
      tag: "Backup",
      tagClass: "border-white/[0.08] text-faint",
      desc: "Multi-server direct links",
    },
  ];

  return (
    <div ref={rootRef} className={cn("relative", wrapperClassName)}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-foreground/90 transition-all hover:bg-white/[0.08] hover:text-foreground active:scale-[0.98]",
          buttonClassName,
        )}
      >
        <Download size={14} />
        Download
        <ChevronDown
          size={13}
          className={cn(
            "text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-50 top-full right-0 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/[0.08] bg-elevated/95 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150 origin-top-right"
        >
          <p className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-faint">
            Download from
          </p>
          {sources.map((s) => (
            <Link
              key={s.name}
              href={s.href}
              onClick={() => setOpen(false)}
              className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.06] active:bg-white/[0.08]"
            >
              <s.icon
                size={15}
                className={cn("mt-0.5 shrink-0", s.iconClass)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-px text-[10px] font-medium leading-tight",
                      s.tagClass,
                    )}
                  >
                    {s.tag}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {s.desc}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
