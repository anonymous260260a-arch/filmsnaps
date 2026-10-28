/**
 * Download library grouping — pure, unit-testable.
 *
 * Builds the sectioned FlatList data for the download manager:
 *   - Sections: Downloading (incl. queued) → Paused → Completed → Failed →
 *     Cancelled → Retrying.
 *   - TV episodes of the same show collapse into ONE expandable "show" entry —
 *     never 10 loose episode rows. A show renders in the section matching its
 *     aggregate state (any active episode → Downloading, any paused → Paused,
 *     …), so a partially-downloaded show stays visible and coherent.
 *   - Header counts list ENTRIES (a show counts as one), not raw episode rows.
 */

import type { DownloadTask } from "./types";

export type DownloadSection =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying";

export type DownloadSectionItem =
  | { type: "header"; key: string; section: DownloadSection; count: number }
  | { type: "task"; key: string; section: DownloadSection; id: string }
  | { type: "show"; key: string; section: DownloadSection; ids: string[] };

const SECTION_ORDER: DownloadSection[] = [
  "active",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "retrying",
];

const HEADER_LABELS: Record<DownloadSection, string> = {
  active: "active-header",
  paused: "paused-header",
  completed: "completed-header",
  failed: "failed-header",
  cancelled: "cancelled-header",
  retrying: "retrying-header",
};

function sectionOf(task: DownloadTask): DownloadSection {
  switch (task.status) {
    case "downloading":
    case "pending":
      return "active";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "retrying":
      return "retrying";
    default:
      return "active";
  }
}

function showAggregateSection(eps: DownloadTask[]): DownloadSection {
  // Highest-priority aggregate state wins: an actively downloading episode
  // pulls the whole show into "Downloading", even if 9/10 finished earlier.
  const rank: Record<DownloadSection, number> = {
    active: 0,
    paused: 1,
    failed: 2,
    completed: 3,
    cancelled: 4,
    retrying: 5,
  };
  return eps
    .map(sectionOf)
    .reduce((best, s) => (rank[s] < rank[best] ? s : best), "completed");
}

/** True when the task belongs to a grouped TV show (an episode row). */
export function isEpisodeTask(task: DownloadTask): boolean {
  return task.mediaType === "tv" && !!task.tmdbId && task.season != null;
}

export function groupDownloadsForSections(
  tasks: DownloadTask[],
): DownloadSectionItem[] {
  const showGroups = new Map<string, DownloadTask[]>();
  const singles: DownloadTask[] = [];

  for (const t of tasks) {
    if (isEpisodeTask(t)) {
      const key = `show-${t.tmdbId}`;
      const group = showGroups.get(key);
      if (group) group.push(t);
      else showGroups.set(key, [t]);
    } else {
      singles.push(t);
    }
  }

  // Shows, bucketed by aggregate section.
  const showsBySection = new Map<DownloadSection, string[][]>();
  for (const [, eps] of showGroups) {
    const section = showAggregateSection(eps);
    const bucket = showsBySection.get(section) ?? [];
    bucket.push(eps.map((e) => e.id));
    showsBySection.set(section, bucket);
  }

  // Flat tasks, bucketed by their own section.
  const tasksBySection = new Map<DownloadSection, DownloadTask[]>();
  for (const t of singles) {
    const bucket = tasksBySection.get(sectionOf(t)) ?? [];
    bucket.push(t);
    tasksBySection.set(sectionOf(t), bucket);
  }

  const items: DownloadSectionItem[] = [];
  for (const section of SECTION_ORDER) {
    const shows = showsBySection.get(section) ?? [];
    const sectionTasks = tasksBySection.get(section) ?? [];
    if (shows.length === 0 && sectionTasks.length === 0) continue;

    items.push({
      type: "header",
      key: HEADER_LABELS[section],
      section,
      count: shows.length + sectionTasks.length,
    });
    shows.forEach((ids, i) =>
      items.push({ type: "show", key: `${section}-show-${i}`, section, ids }),
    );
    sectionTasks.forEach((t) =>
      items.push({
        type: "task",
        key: `${section}-${t.id}`,
        section,
        id: t.id,
      }),
    );
  }

  return items;
}
