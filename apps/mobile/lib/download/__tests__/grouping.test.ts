import { describe, it, expect } from "vitest";
import { groupDownloadsForSections, isEpisodeTask } from "../grouping";
import type { DownloadTask } from "../types";

function task(overrides: Partial<DownloadTask> & { id: string }): DownloadTask {
  return {
    url: `https://example.com/${overrides.id}`,
    fileName: `${overrides.id}.mp4`,
    server: "hdhub",
    fileUri: null,
    totalBytes: 1000,
    receivedBytes: 0,
    status: "downloading",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as DownloadTask;
}

const episode = (
  id: string,
  opts: {
    status?: DownloadTask["status"];
    tmdbId?: string;
    season?: number;
    episode?: number;
  } = {},
) =>
  task({
    id,
    mediaType: "tv",
    tmdbId: opts.tmdbId ?? "42",
    season: opts.season ?? 1,
    episode: opts.episode ?? 1,
    status: opts.status ?? "downloading",
  });

describe("isEpisodeTask", () => {
  it("groups only TV tasks with a tmdbId and a season", () => {
    expect(isEpisodeTask(episode("e1"))).toBe(true);
    expect(
      isEpisodeTask(task({ id: "m1", mediaType: "movie", tmdbId: "42" })),
    ).toBe(false);
    expect(isEpisodeTask(task({ id: "t1", mediaType: "tv" }))).toBe(false);
  });
});

describe("groupDownloadsForSections", () => {
  it("collapses one show's episodes into a single show entry", () => {
    const items = groupDownloadsForSections([
      episode("e1", { episode: 1, status: "completed" }),
      episode("e2", { episode: 2, status: "completed" }),
      episode("e3", { episode: 3, status: "downloading" }),
    ]);

    const shows = items.filter((i) => i.type === "show");
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({
      type: "show",
      section: "active",
      ids: ["e1", "e2", "e3"],
    });

    // No loose episode rows anywhere.
    expect(items.filter((i) => i.type === "task")).toHaveLength(0);

    // Header counts ENTRIES: 1 show, not 3 episodes.
    const header = items.find((i) => i.type === "header");
    expect(header).toMatchObject({ section: "active", count: 1 });
  });

  it("keeps two different shows as separate entries", () => {
    const items = groupDownloadsForSections([
      episode("a1", { tmdbId: "1" }),
      episode("b1", { tmdbId: "2" }),
    ]);
    expect(items.filter((i) => i.type === "show")).toHaveLength(2);
  });

  it("keeps the same title at different qualities as separate movie rows", () => {
    const items = groupDownloadsForSections([
      task({ id: "m-1080", mediaType: "movie", tmdbId: "9" }),
      task({ id: "m-720", mediaType: "movie", tmdbId: "9" }),
    ]);
    expect(items.filter((i) => i.type === "task")).toHaveLength(2);
  });

  it("places a show in the highest-priority aggregate section", () => {
    const items = groupDownloadsForSections([
      episode("e1", { status: "completed" }),
      episode("e2", { status: "failed" }),
      episode("e3", { status: "paused" }),
    ]);
    // paused outranks failed/completed; nothing is actively downloading.
    expect(items[0]).toMatchObject({ type: "header", section: "paused" });
  });

  it("orders sections: active → paused → completed → failed → cancelled → retrying", () => {
    const items = groupDownloadsForSections([
      task({ id: "f1", status: "failed" }),
      task({ id: "c1", status: "completed" }),
      task({ id: "x1", status: "cancelled" }),
      task({ id: "p1", status: "paused" }),
      task({ id: "a1", status: "downloading" }),
      task({ id: "q1", status: "pending" }),
      task({ id: "r1", status: "retrying" }),
    ]);
    expect(
      items.filter((i) => i.type === "header").map((i) => i.section),
    ).toEqual([
      "active",
      "paused",
      "completed",
      "failed",
      "cancelled",
      "retrying",
    ]);
    // A queued (pending) task is visible in the active section.
    expect(items.some((i) => i.type === "task" && i.id === "q1")).toBe(true);
  });

  it("returns an empty list for no tasks", () => {
    expect(groupDownloadsForSections([])).toEqual([]);
  });
});
