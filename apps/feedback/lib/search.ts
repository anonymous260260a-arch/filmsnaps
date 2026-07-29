import Fuse from "fuse.js";
import type {
  BugReport,
  FeatureRequest,
  FaqCategory,
  RoadmapItem,
} from "./types";

// ── Fuse Configuration ──

const FUSE_OPTIONS = {
  threshold: 0.4,
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 3,
} as const;

// ── Generic Search ──

export function searchBugs(bugs: BugReport[], query: string): BugReport[] {
  if (!query.trim()) return bugs;
  const fuse = new Fuse(bugs, {
    ...FUSE_OPTIONS,
    keys: ["title", "description", "expectedBehavior", "actualBehavior"],
  });
  return fuse.search(query).map((r) => r.item);
}

export function searchFeatures(
  features: FeatureRequest[],
  query: string,
): FeatureRequest[] {
  if (!query.trim()) return features;
  const fuse = new Fuse(features, {
    ...FUSE_OPTIONS,
    keys: ["title", "description", "problem", "suggestedSolution"],
  });
  return fuse.search(query).map((r) => r.item);
}

export function searchRoadmap(
  items: RoadmapItem[],
  query: string,
): RoadmapItem[] {
  if (!query.trim()) return items;
  const fuse = new Fuse(items, {
    ...FUSE_OPTIONS,
    keys: ["title", "description"],
  });
  return fuse.search(query).map((r) => r.item);
}

export function searchFaq(
  categories: FaqCategory[],
  query: string,
): FaqCategory[] {
  if (!query.trim()) return categories;
  // Flatten items, search across question/answer
  const allItems = categories.flatMap((cat) =>
    cat.items.map((item) => ({
      ...item,
      categoryName: cat.name,
      categoryId: cat.id,
    })),
  );
  const fuse = new Fuse(allItems, {
    ...FUSE_OPTIONS,
    keys: ["question", "answer", "categoryName"],
  });
  const matched = fuse.search(query).map((r) => r.item);
  // Re-group by category, only keeping matched items
  const catMap = new Map<string, FaqCategory>();
  for (const item of matched) {
    const original = categories.find((c) => c.id === item.categoryId);
    if (!original) continue;
    if (!catMap.has(item.categoryId)) {
      catMap.set(item.categoryId, {
        ...original,
        items: [],
      });
    }
    const cat = catMap.get(item.categoryId)!;
    cat.items.push(original.items.find((oi) => oi.question === item.question)!);
  }
  return Array.from(catMap.values());
}

// ── Duplicate Detection ──

export interface DuplicateResult {
  id: string;
  title: string;
  score: number;
  existing: BugReport | FeatureRequest;
}

export function findDuplicates(
  title: string,
  existingItems: (BugReport | FeatureRequest)[],
  threshold: number = 0.4,
): DuplicateResult[] {
  if (!title.trim() || title.length < 4) return [];

  const fuse = new Fuse(existingItems, {
    ...FUSE_OPTIONS,
    keys: ["title"],
    threshold,
  });

  return fuse
    .search(title)
    .filter((r) => r.score !== undefined && r.score < threshold)
    .map((r) => ({
      id: r.item.id,
      title: r.item.title,
      score: r.score!,
      existing: r.item,
    }))
    .sort((a, b) => a.score - b.score);
}
