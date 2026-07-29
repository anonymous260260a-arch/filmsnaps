"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SearchBar } from "@/components/SearchBar";
import { CloudflareAdapter } from "@/lib/cloudflare-adapter";
import { searchRoadmap } from "@/lib/search";
import { getVisitorId } from "@/lib/visitor";
import type { RoadmapItem, RoadmapStatus } from "@/lib/types";

const storage = new CloudflareAdapter();

const STATUS_ORDER: RoadmapStatus[] = ["planned", "in-progress", "completed"];

const STATUS_TITLES: Record<RoadmapStatus, string> = {
  planned: "Planned",
  "in-progress": "In Progress",
  completed: "Completed",
};

export default function RoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [query, setQuery] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [upvoted, setUpvoted] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sid = getVisitorId();
    setSessionId(sid);
    storage.getRoadmap().then(setItems);
    // Load upvote state from server
    if (sid) {
      // hasUpvoted is checked per-item on mount
    }
  }, []);

  const filtered = searchRoadmap(items, query);

  const handleUpvote = async (id: string) => {
    if (!sessionId) return;
    const already = upvoted.has(id);
    if (already) {
      await storage.removeUpvote(id, sessionId, "roadmap");
      setUpvoted((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      await storage.upvote(id, sessionId, "roadmap");
      setUpvoted((prev) => new Set(prev).add(id));
    }
    storage.getRoadmap().then(setItems);
  };

  const columns = STATUS_ORDER.map((status) => ({
    status,
    items: filtered.filter((i) => i.status === status),
  }));

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Roadmap</h1>
            <p className="text-sm text-muted-foreground">
              See what we are working on and what is coming next.
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="my-6">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search roadmap..."
          />
        </div>

        {/* Columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {columns.map(({ status, items: colItems }) => (
            <div key={status}>
              <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    status === "planned"
                      ? "bg-blue-500"
                      : status === "in-progress"
                        ? "bg-purple-500"
                        : "bg-green-500"
                  }`}
                />
                {STATUS_TITLES[status]}
                <span className="text-muted-foreground font-normal">
                  ({colItems.length})
                </span>
              </h2>
              <div className="space-y-3">
                {colItems.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No items
                  </p>
                )}
                {colItems.map((item) => {
                  const isUpvoted = upvoted.has(item.id);
                  return (
                    <Card key={item.id} className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <h3 className="font-medium text-sm leading-snug">
                          {item.title}
                        </h3>
                        <button
                          onClick={() => handleUpvote(item.id)}
                          className={`shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                            isUpvoted
                              ? "border-primary text-primary bg-primary/10"
                              : "border-border text-muted-foreground hover:border-primary/30"
                          }`}
                        >
                          <ThumbsUp
                            className={`w-3 h-3 ${isUpvoted ? "fill-current" : ""}`}
                          />
                          {item.upvotes}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                        {item.description}
                      </p>
                      {item.status !== "planned" && (
                        <Progress value={item.progress} className="h-1.5" />
                      )}
                      {item.estimatedRelease && (
                        <p className="text-[10px] text-muted-foreground mt-2">
                          Target: {item.estimatedRelease}
                        </p>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
