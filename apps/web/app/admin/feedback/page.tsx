"use client";

/**
 * /admin/feedback — the feedback, idea and bug inbox.
 *
 * Auth: HTTP Basic (ADMIN_TOKEN) enforced by middleware.ts for /admin; the
 * browser replays the credentials on these same-origin fetches.
 *
 * Reads and writes go through /api/feedback/list only, so reply work never
 * pays for the heavy telemetry dashboard queries. Saving a reply marks the row
 * 'done' and the sender reads it back inside the app (Feedback screen).
 */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl, apiClientHeaders } from "@/lib/tmdb";
import { GOLD } from "../components/constants";

type Status = "new" | "read" | "done" | "spam";
type TabKey = Status | "all";

interface Row {
  id: number;
  day: string;
  type: string;
  message: string;
  rating: number | null;
  client: string | null;
  appVersion: string | null;
  status: Status;
  flagged: number;
  reply: string | null;
  repliedTs: number | null;
  replyVote: "like" | "dislike" | null;
  thread: string | null;
  ts: number;
}

interface Payload {
  rows: Row[];
  counts: Record<string, number>;
  rating: { avg: number | null; count: number };
  prompt: { rated: number; declined: number };
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "new", label: "New" },
  { key: "read", label: "Read" },
  { key: "done", label: "Done" },
  { key: "spam", label: "Spam" },
  { key: "all", label: "All" },
];

const TYPE_STYLE: Record<string, { label: string; cls: string }> = {
  bug: { label: "Bug", cls: "text-red-400 bg-red-400/10 border-red-400/25" },
  idea: {
    label: "Idea",
    cls: "text-amber-300 bg-amber-300/10 border-amber-300/25",
  },
  question: {
    label: "Question",
    cls: "text-sky-300 bg-sky-300/10 border-sky-300/25",
  },
  rating: {
    label: "Rating",
    cls: "text-emerald-300 bg-emerald-300/10 border-emerald-300/25",
  },
};

function when(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stars({ value }: { value: number }) {
  return (
    <span className="text-[13px] tracking-tight" title={`${value} of 5`}>
      <span style={{ color: GOLD }}>{"★".repeat(value)}</span>
      <span className="text-white/15">{"★".repeat(5 - value)}</span>
    </span>
  );
}

function FeedbackCard({
  row,
  onPatch,
  onThread,
}: {
  row: Row;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onThread: (thread: string) => void;
}) {
  const [reply, setReply] = useState(row.reply ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const meta = TYPE_STYLE[row.type] ?? {
    label: row.type,
    cls: "text-white/60 bg-white/5 border-white/10",
  };

  const run = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <article className="bg-elevated border border-white/[0.07] rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span
          className={`text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${meta.cls}`}
        >
          {meta.label}
        </span>
        {row.rating != null && <Stars value={row.rating} />}
        {row.flagged === 1 && (
          <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-red-500/40 text-red-300 bg-red-500/10">
            Flagged
          </span>
        )}
        <span className="text-[11px] text-white/30 font-mono ml-auto">
          {when(row.ts)}
        </span>
      </div>

      {row.message.trim() ? (
        <p className="text-[13.5px] leading-relaxed text-white/[0.82] whitespace-pre-wrap break-words">
          {row.message}
        </p>
      ) : (
        <p className="text-[13px] italic text-white/30">
          Rating only — no note.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-white/35 font-mono">
        <span>#{row.id}</span>
        {row.appVersion && <span>v{row.appVersion}</span>}
        {row.client && <span>{row.client}</span>}
        {row.thread && (
          <button
            onClick={() => onThread(row.thread as string)}
            className="ml-auto px-2 py-0.5 rounded border border-white/[0.08] text-white/50 hover:text-white hover:border-primary/40 transition-colors font-sans"
          >
            All messages from this sender
          </button>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-white/[0.06]">
        {row.reply ? (
          <div className="mb-3 rounded-xl bg-primary/[0.06] border border-primary/20 px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-primary/80 font-bold mb-1">
              Replied {row.repliedTs ? when(row.repliedTs) : ""}
            </div>
            <p className="text-[13px] leading-relaxed text-white/[0.85] whitespace-pre-wrap break-words">
              {row.reply}
            </p>
            {row.replyVote && (
              <span
                className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                  row.replyVote === "like"
                    ? "text-emerald-300"
                    : "text-white/45"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {row.replyVote === "like"
                  ? "Sender found this helpful"
                  : "Sender did not find this helpful"}
              </span>
            )}
          </div>
        ) : null}

        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={
            row.reply
              ? "Edit the reply…"
              : "Write a reply — it shows up in the sender's app"
          }
          className="w-full bg-background/60 border border-white/[0.09] rounded-xl px-3 py-2 text-[13px] text-white/[0.9] placeholder:text-white/25 focus:outline-none focus:border-primary/50 resize-y"
        />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button
            onClick={() => void run(() => onPatch({ id: row.id, reply }))}
            disabled={saving}
            className="px-3 py-1.5 text-[12px] font-bold rounded-lg bg-primary text-background hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : row.reply ? "Update reply" : "Send reply"}
          </button>
          {TABS.filter((t) => t.key !== "all").map((t) => (
            <button
              key={t.key}
              onClick={() =>
                void run(() => onPatch({ id: row.id, status: t.key }))
              }
              disabled={saving || row.status === t.key}
              className={`px-2.5 py-1.5 text-[11.5px] font-semibold rounded-lg border transition-colors disabled:opacity-40 ${
                row.status === t.key
                  ? "border-primary/40 text-primary"
                  : "border-white/[0.08] text-white/50 hover:text-white hover:border-white/20"
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => {
              if (!window.confirm(`Delete feedback #${row.id}?`)) return;
              void run(() => onPatch({ id: row.id, deleted: true }));
            }}
            disabled={saving}
            className="ml-auto px-2.5 py-1.5 text-[11.5px] font-semibold rounded-lg border border-red-500/25 text-red-300/80 hover:bg-red-500/10 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
        {err && <div className="mt-2 text-[12px] text-red-400">{err}</div>}
      </div>
    </article>
  );
}

export default function AdminFeedbackPage() {
  const [tab, setTab] = useState<TabKey>("new");
  const [thread, setThread] = useState<string | null>(null);
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = thread
        ? `status=all&thread=${encodeURIComponent(thread)}&limit=200`
        : `status=${tab}&limit=100${includeFlagged ? "&includeFlagged=1" : ""}`;
      const res = await fetch(apiUrl(`/api/feedback/list?${query}`), {
        credentials: "same-origin",
        headers: apiClientHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as Payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tab, includeFlagged, thread]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(apiUrl("/api/feedback/list"), {
        method: "PATCH",
        credentials: "same-origin",
        headers: { ...apiClientHeaders(), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      await load();
    },
    [load],
  );

  const counts = data?.counts ?? {};
  const rated = data?.rating;
  const prompt = data?.prompt;
  const stats: { label: string; value: number; accent?: string }[] = [
    { label: "New", value: counts.new ?? 0, accent: GOLD },
    { label: "Read", value: counts.read ?? 0 },
    { label: "Done", value: counts.done ?? 0 },
    { label: "Spam", value: counts.spam ?? 0 },
  ];

  return (
    <div className="min-h-screen bg-background text-white/[0.88] font-sans antialiased selection:bg-primary/30">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-background/90 backdrop-blur-md border-b border-white/[0.07]">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>FilmSnaps</span>
            <span
              className="text-xs uppercase px-2 py-0.5 rounded font-extrabold tracking-wider"
              style={{
                backgroundColor: `${GOLD}22`,
                color: GOLD,
                border: `1px solid ${GOLD}44`,
              }}
            >
              Feedback
            </span>
          </h1>
          <Link
            href="/admin"
            className="text-xs font-medium text-white/50 hover:text-white transition-colors"
          >
            ← Telemetry dashboard
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[11.5px] text-white/45 cursor-pointer">
            <input
              type="checkbox"
              checked={includeFlagged}
              onChange={(e) => setIncludeFlagged(e.target.checked)}
              className="accent-primary"
            />
            Show flagged
          </label>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white bg-elevated border border-white/[0.08] hover:border-primary/40 rounded-xl transition-all disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <main className="max-w-[980px] mx-auto px-4 sm:px-6 py-6 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="bg-elevated border border-white/[0.07] rounded-2xl px-4 py-3"
            >
              <div className="text-[10.5px] uppercase tracking-wider text-white/35 font-bold">
                {s.label}
              </div>
              <div
                className="text-2xl font-bold mt-1"
                style={{ color: s.accent ?? "white" }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {rated &&
          (rated.count > 0 ||
            (prompt?.rated ?? 0) + (prompt?.declined ?? 0) > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 bg-elevated border border-white/[0.07] rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] uppercase tracking-wider text-white/35 font-bold">
                  App rating
                </span>
                <span className="text-lg font-bold" style={{ color: GOLD }}>
                  {rated.avg != null ? rated.avg.toFixed(2) : "—"}
                </span>
                <Stars value={Math.round(rated.avg ?? 0)} />
                <span className="text-[11.5px] text-white/35">
                  from {rated.count} rating{rated.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-6 sm:ml-auto">
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-white/35 font-bold">
                    Prompt · rated
                  </div>
                  <div className="text-lg font-bold text-emerald-300">
                    {prompt?.rated ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-white/35 font-bold">
                    Prompt · refused
                  </div>
                  <div className="text-lg font-bold text-white/60">
                    {prompt?.declined ?? 0}
                  </div>
                </div>
              </div>
            </div>
          )}

        {thread && (
          <div className="mt-5 flex flex-wrap items-center gap-3 bg-elevated border border-primary/25 rounded-2xl px-4 py-3">
            <span className="text-[12.5px] text-white/70">
              Every message from this sender
            </span>
            <span className="font-mono text-[11px] text-white/35">
              {thread.slice(0, 8)}…
            </span>
            <button
              onClick={() => setThread(null)}
              className="ml-auto px-3 py-1 text-[11.5px] font-semibold rounded-lg border border-white/[0.08] text-white/60 hover:text-white hover:border-white/20 transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 bg-elevated p-1 rounded-xl border border-white/[0.07] mt-5 w-fit">
          {TABS.map((t) => {
            const active = tab === t.key && !thread;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setThread(null);
                  setTab(t.key);
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                  active
                    ? "bg-primary text-background font-bold shadow-sm"
                    : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                }`}
              >
                {t.label}
                <span
                  className={active ? "text-background/60" : "text-white/30"}
                >
                  {counts[t.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="my-6 p-5 bg-elevated border border-red-500/30 rounded-2xl">
            <h2 className="text-sm font-bold text-white mb-1">
              Inbox unavailable
            </h2>
            <p className="text-[12.5px] text-white/60 leading-relaxed mb-3">
              {error === "db-unbound"
                ? "The D1 binding is not available in this runtime."
                : `API error: ${error}. Check ADMIN_TOKEN and the feedback migrations (007–009).`}
            </p>
            <button
              onClick={() => void load()}
              className="px-3 py-1.5 bg-primary text-background font-bold text-xs rounded-lg"
            >
              Retry
            </button>
          </div>
        )}

        {!error && loading && !data && (
          <div className="space-y-3 mt-5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-40 rounded-2xl animate-pulse bg-white/[0.04]"
              />
            ))}
          </div>
        )}

        {!error && data && data.rows.length === 0 && (
          <div className="mt-10 text-center text-white/30 text-sm">
            Nothing in {tab === "all" ? "the inbox" : tab} right now.
          </div>
        )}

        <div className="space-y-3 mt-5">
          {data?.rows.map((row) => (
            <FeedbackCard
              key={row.id}
              row={row}
              onPatch={patch}
              onThread={setThread}
            />
          ))}
        </div>
      </main>

      <footer className="max-w-[980px] mx-auto px-4 sm:px-6 py-8 border-t border-white/[0.06] text-xs text-white/30">
        Replies are stored with the submission and appear in the sender's app
        under Settings → Feedback. Only feedback is loaded on this page.
      </footer>
    </div>
  );
}
