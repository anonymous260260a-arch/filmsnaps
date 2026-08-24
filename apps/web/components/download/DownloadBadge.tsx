/**
 * DownloadBadge — A subtle pill on the detail page header showing active download count.
 *
 * Tapping navigates to the Downloads management page.
 * Disappears when no downloads are active.
 */

import React from "react";
import { useDownloadList } from "@/lib/downloadStore";

export default function DownloadBadge() {
  const tasks = useDownloadList();
  const count = tasks.filter((t) => t.state === "active").length;

  if (count === 0) return null;

  return (
    <a
      href="/downloads"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-white/[0.06] transition-colors"
      style={{ color: "#D4A237" }}
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        <line x1="12" y1="19" x2="12" y2="13" />
      </svg>
      <span className="text-[11px] font-bold ml-1">{count}</span>
    </a>
  );
}
