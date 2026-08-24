"use client";

/**
 * Download Manager (media) — desktop-only Phase 2 surface.
 *
 * Aggregates all managed downloads into status groups (active / paused /
 * completed / failed) with live progress, pause/resume/cancel, file
 * management, and a speed-limit selector — parity with mobile's downloads.tsx.
 *
 * On the public web (no Electron runtime) it explains that downloads live in
 * the desktop app and links to the install page. The install page (/download)
 * remains reachable from here so its SEO/value is preserved.
 */

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Download,
  Pause,
  Play,
  X,
  FolderOpen,
  Trash2,
  Plus,
  Film,
  Gauge,
  Monitor,
} from "lucide-react";
import { Header } from "@/components/Header";
import { PageShell } from "@/components/PageShell";
import { ProgressBar } from "@/components/download/ProgressBar";
import {
  useDownloadList,
  groupByStatus,
  startDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  openDownload,
  clearDownload,
  setDownloadSpeedLimit,
  isDownloadAvailable,
  type DownloadTask,
} from "@/lib/downloadStore";
import { formatBytes, formatSpeed, formatEta, formatDate } from "@/lib/format";

const SPEED_LEVELS: Array<{
  level: "full" | "balanced" | "slower";
  label: string;
}> = [
  { level: "full", label: "Full speed" },
  { level: "balanced", label: "Balanced" },
  { level: "slower", label: "Slower" },
];

export default function DownloadsPage() {
  const available = isDownloadAvailable();
  const tasks = useDownloadList();
  const groups = useMemo(() => groupByStatus(tasks), [tasks]);
  const [speed, setSpeed] = useState<"full" | "balanced" | "slower">("full");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");

  const handleAdd = () => {
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      setUrlError("Enter a valid http(s) URL");
      return;
    }
    setUrlError("");
    const title = trimmed.split("/").pop() || "Download";
    startDownload({ url: trimmed, title });
    setUrl("");
  };

  if (!available) {
    return (
      <div className="min-h-screen bg-[#070708] text-foreground">
        <Header />
        <PageShell maxWidth="2xl">
          <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-14 text-center">
            <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center mx-auto mb-5">
              <Download className="h-8 w-8 text-[#D4A237]" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">
              Downloads
            </h1>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Offline downloads are managed in the FilmSnaps desktop app.
              Install it to download movies and episodes to watch anytime.
            </p>
            <Link
              href="/download"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
            >
              <Monitor size={14} />
              Get FilmSnaps Desktop
            </Link>
          </div>
        </PageShell>
      </div>
    );
  }

  const total = tasks.length;

  return (
    <div className="min-h-screen bg-[#070708] text-foreground">
      <Header />
      <PageShell maxWidth="5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4A237]/10 flex items-center justify-center">
              <Download size={20} className="text-[#D4A237]" />
            </div>
            <div>
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Downloads
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {total} {total === 1 ? "item" : "items"}
              </p>
            </div>
          </div>

          {/* Speed limit */}
          <div className="flex items-center gap-2">
            <Gauge size={14} className="text-muted-foreground" />
            <div className="flex rounded-xl bg-white/[0.04] border border-white/[0.06] p-0.5">
              {SPEED_LEVELS.map((s) => (
                <button
                  key={s.level}
                  onClick={() => {
                    setSpeed(s.level);
                    setDownloadSpeedLimit(s.level);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    speed === s.level
                      ? "bg-[#D4A237] text-[#070708]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Add-by-URL (utility + testing) */}
        <div className="flex items-center gap-2 mb-8 rounded-xl bg-[#0E0E11] border border-white/[0.06] p-2.5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="Paste a direct media/file URL to download…"
            className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-faint outline-none"
          />
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
        {urlError && (
          <p className="text-xs text-[#E05252] -mt-6 mb-6">{urlError}</p>
        )}

        {total === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-14 text-center">
            <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center mx-auto mb-4">
              <Download className="h-8 w-8 text-faint" />
            </div>
            <h3 className="text-base font-semibold mb-1">No downloads yet</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
              Paste a direct media URL above to start an offline download.
            </p>
            <Link
              href="/movie"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
            >
              <Film size={14} />
              Browse Movies
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            <StatusGroup title="In Progress" tasks={groups.active} accent />
            <StatusGroup title="Paused" tasks={groups.paused} />
            <StatusGroup title="Completed" tasks={groups.completed} />
            <StatusGroup title="Failed" tasks={groups.failed} />
          </div>
        )}
      </PageShell>
    </div>
  );
}

function StatusGroup({
  title,
  tasks,
  accent,
}: {
  title: string;
  tasks: DownloadTask[];
  accent?: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-faint mb-3">
        {title} · {tasks.length}
      </h2>
      <div className="space-y-2">
        {tasks.map((t) => (
          <DownloadRow key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

function DownloadRow({ task }: { task: DownloadTask }) {
  const pct =
    task.totalBytes > 0
      ? task.receivedBytes / task.totalBytes
      : task.state === "completed"
        ? 1
        : 0;
  const remaining = Math.max(0, task.totalBytes - task.receivedBytes);
  const isActive = task.state === "active";
  const isPaused = task.state === "paused";
  const isCompleted = task.state === "completed";
  const barColor = isCompleted
    ? "bg-[#3FB950]"
    : isPaused
      ? "bg-[#D4A237]"
      : "bg-[#5B9CF6]";

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-[#0E0E11] border border-[#222226] hover:border-[#D4A237]/20 transition-all group">
      {/* Icon */}
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#16161A] to-[#0E0E11] flex items-center justify-center shrink-0 ring-1 ring-white/[0.06]">
        <Download className="w-4 h-4 text-[#D4A237]/70" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {task.title}
        </p>
        <p className="text-[11px] text-faint truncate">{task.fileName}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex-1 max-w-xs">
            <ProgressBar value={pct} colorClass={barColor} showPercent />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
            {formatBytes(task.receivedBytes)}
            {task.totalBytes > 0 && ` / ${formatBytes(task.totalBytes)}`}
          </span>
        </div>
        {/* Secondary line: speed / ETA / status */}
        <div className="mt-1 flex items-center gap-3 text-[11px] text-faint">
          {isActive && (
            <>
              <span>{formatSpeed(task.speedBytesPerSec)}</span>
              <span>·</span>
              <span>
                {formatEta(remaining, task.speedBytesPerSec)} remaining
              </span>
            </>
          )}
          {isPaused && <span>Paused</span>}
          {isCompleted && <span>{formatDate(task.updatedAt)}</span>}
          {task.state === "failed" && (
            <span className="text-[#E05252]">
              {task.error ? String(task.error) : "Failed"}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isActive && (
          <ActionButton
            label="Pause"
            onClick={() => pauseDownload(task.id)}
            icon={<Pause size={14} />}
          />
        )}
        {isPaused && (
          <ActionButton
            label="Resume"
            onClick={() => resumeDownload(task.id)}
            icon={<Play size={14} />}
          />
        )}
        {(isActive || isPaused) && (
          <ActionButton
            label="Cancel"
            onClick={() => cancelDownload(task.id)}
            icon={<X size={14} />}
            danger
          />
        )}
        {isCompleted && (
          <ActionButton
            label="Open folder"
            onClick={() => openDownload(task.id)}
            icon={<FolderOpen size={14} />}
          />
        )}
        {isCompleted && (
          <ActionButton
            label="Remove"
            onClick={() => clearDownload(task.id, true)}
            icon={<Trash2 size={14} />}
            danger
          />
        )}
        {task.state === "failed" && (
          <ActionButton
            label="Remove"
            onClick={() => clearDownload(task.id)}
            icon={<Trash2 size={14} />}
            danger
          />
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  icon,
  danger,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-all ${
        danger
          ? "border-[#E05252]/20 text-[#E05252] hover:bg-[#E05252]/10"
          : "border-white/[0.08] text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
      }`}
    >
      {icon}
    </button>
  );
}
