"use client";

import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "@/components/SearchBar";
import { CloudflareAdapter } from "@/lib/cloudflare-adapter";
import { CHANGE_TYPE_LABELS } from "@/lib/constants";
import type { ChangelogEntry, ChangeType } from "@/lib/types";

const storage = new CloudflareAdapter();

const CHANGE_BADGE_VARIANTS: Record<
  ChangeType,
  "default" | "secondary" | "destructive" | "outline"
> = {
  feature: "default",
  improvement: "secondary",
  fix: "outline",
  security: "destructive",
};

export default function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    storage.getChangelog().then(setEntries);
  }, []);

  const filtered = query.trim()
    ? entries
        .map((entry) => ({
          ...entry,
          changes: entry.changes.filter(
            (c) =>
              c.description.toLowerCase().includes(query.toLowerCase()) ||
              CHANGE_TYPE_LABELS[c.type]
                .toLowerCase()
                .includes(query.toLowerCase()),
          ),
        }))
        .filter((entry) => entry.changes.length > 0)
    : entries;

  return (
    <main className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Changelog</h1>
            <p className="text-sm text-muted-foreground">
              Track every update, fix, and improvement.
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="my-6">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search changelog..."
          />
        </div>

        {/* Timeline */}
        <div className="relative">
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No matching entries found.
            </p>
          )}
          {filtered.map((entry, idx) => (
            <div key={entry.version} className="relative pb-8 last:pb-0">
              {/* Timeline line */}
              {idx < filtered.length - 1 && (
                <div className="absolute left-[11px] top-8 bottom-0 w-px bg-border" />
              )}

              <div className="flex gap-4">
                {/* Timeline dot */}
                <div className="shrink-0 w-6 h-6 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-3 mb-2">
                    <h2 className="text-lg font-semibold">v{entry.version}</h2>
                    <time className="text-xs text-muted-foreground">
                      {entry.releaseDate}
                    </time>
                  </div>

                  <div className="space-y-2">
                    {entry.changes.map((change, ci) => (
                      <div key={ci} className="flex items-start gap-2 text-sm">
                        <Badge
                          variant={CHANGE_BADGE_VARIANTS[change.type]}
                          className="shrink-0 mt-0.5 text-[10px] px-1.5 py-0"
                        >
                          {CHANGE_TYPE_LABELS[change.type]}
                        </Badge>
                        <span className="text-foreground/80">
                          {change.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
