import type { StorageProvider } from "./storage";
import type {
  BugReport,
  FeatureRequest,
  FeedbackStatus,
  RoadmapItem,
  ChangelogEntry,
  FaqCategory,
} from "./types";
import { SEED_ROADMAP, SEED_CHANGELOG, SEED_FAQ } from "./constants";

// ── Storage Keys ──

const KEYS = {
  bugs: "@filmsnaps/feedback/bugs",
  features: "@filmsnaps/feedback/features",
  roadmap: "@filmsnaps/feedback/roadmap",
  changelog: "@filmsnaps/feedback/changelog",
  faq: "@filmsnaps/feedback/faq",
  sessionId: "@filmsnaps/feedback/session-id",
  lastSubmit: "@filmsnaps/feedback/last-submit",
} as const;

// ── Helpers ──

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      throw new Error(
        "Storage is full. Please clear some browser data and try again.",
      );
    }
    throw e;
  }
}

// ── Session ID ──

export function getSessionId(): string {
  let id = localStorage.getItem(KEYS.sessionId);
  if (!id) {
    id =
      crypto.randomUUID?.() ??
      `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEYS.sessionId, id);
  }
  return id;
}

// ── Cooldown Check ──

export function checkSubmissionCooldown(cooldownMs: number): number {
  const lastRaw = localStorage.getItem(KEYS.lastSubmit);
  if (!lastRaw) return 0;
  const elapsed = Date.now() - parseInt(lastRaw, 10);
  return elapsed < cooldownMs ? cooldownMs - elapsed : 0;
}

export function setLastSubmit(): void {
  localStorage.setItem(KEYS.lastSubmit, String(Date.now()));
}

// ── LocalStorageAdapter ──

export class LocalStorageAdapter implements StorageProvider {
  // ── Bugs ──

  async getBugs(): Promise<BugReport[]> {
    return read<BugReport[]>(KEYS.bugs, []);
  }

  async createBug(
    data: Omit<
      BugReport,
      "id" | "createdAt" | "updatedAt" | "upvotes" | "upvotedBy"
    >,
  ): Promise<BugReport> {
    const bugs = await this.getBugs();
    const now = new Date().toISOString();
    const bug: BugReport = {
      ...data,
      id: `bug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "bug",
      createdAt: now,
      updatedAt: now,
      upvotes: 0,
      upvotedBy: [],
    };
    bugs.push(bug);
    write(KEYS.bugs, bugs);
    return bug;
  }

  async updateBugStatus(id: string, status: FeedbackStatus): Promise<void> {
    const bugs = await this.getBugs();
    const idx = bugs.findIndex((b) => b.id === id);
    if (idx !== -1) {
      bugs[idx].status = status;
      bugs[idx].updatedAt = new Date().toISOString();
      write(KEYS.bugs, bugs);
    }
  }

  // ── Feature Requests ──

  async getFeatureRequests(): Promise<FeatureRequest[]> {
    return read<FeatureRequest[]>(KEYS.features, []);
  }

  async createFeatureRequest(
    data: Omit<
      FeatureRequest,
      "id" | "createdAt" | "updatedAt" | "upvotes" | "upvotedBy"
    >,
  ): Promise<FeatureRequest> {
    const features = await this.getFeatureRequests();
    const now = new Date().toISOString();
    const feature: FeatureRequest = {
      ...data,
      id: `feat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "feature",
      createdAt: now,
      updatedAt: now,
      upvotes: 0,
      upvotedBy: [],
    };
    features.push(feature);
    write(KEYS.features, features);
    return feature;
  }

  async updateFeatureRequestStatus(
    id: string,
    status: FeedbackStatus,
  ): Promise<void> {
    const features = await this.getFeatureRequests();
    const idx = features.findIndex((f) => f.id === id);
    if (idx !== -1) {
      features[idx].status = status;
      features[idx].updatedAt = new Date().toISOString();
      write(KEYS.features, features);
    }
  }

  // ── Upvoting ──

  private getUpvoteKey(type: "bug" | "feature" | "roadmap"): string {
    return `@filmsnaps/feedback/upvotes/${type}`;
  }

  private async getUpvotedIds(
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<string[]> {
    const key = this.getUpvoteKey(type);
    const map = read<Record<string, string[]>>(key, {});
    return map[sessionId] ?? [];
  }

  private async setUpvotedIds(
    sessionId: string,
    ids: string[],
    type: "bug" | "feature" | "roadmap",
  ): Promise<void> {
    const key = this.getUpvoteKey(type);
    const map = read<Record<string, string[]>>(key, {});
    map[sessionId] = ids;
    write(key, map);
  }

  async upvote(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<void> {
    const upvoted = await this.getUpvotedIds(sessionId, type);
    if (upvoted.includes(id)) return;
    upvoted.push(id);
    await this.setUpvotedIds(sessionId, upvoted, type);

    // Increment the item's upvote count
    if (type === "roadmap") {
      const items = await this.getRoadmap();
      const item = items.find((r) => r.id === id);
      if (item) {
        item.upvotes++;
        item.upvotedBy.push(sessionId);
        write(KEYS.roadmap, items);
      }
    } else if (type === "bug") {
      const bugs = await this.getBugs();
      const bug = bugs.find((b) => b.id === id);
      if (bug) {
        bug.upvotes++;
        bug.upvotedBy.push(sessionId);
        write(KEYS.bugs, bugs);
      }
    } else {
      const features = await this.getFeatureRequests();
      const feature = features.find((f) => f.id === id);
      if (feature) {
        feature.upvotes++;
        feature.upvotedBy.push(sessionId);
        write(KEYS.features, features);
      }
    }
  }

  async removeUpvote(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<void> {
    const upvoted = await this.getUpvotedIds(sessionId, type);
    const filtered = upvoted.filter((uid) => uid !== id);
    if (filtered.length === upvoted.length) return;
    await this.setUpvotedIds(sessionId, filtered, type);

    if (type === "roadmap") {
      const items = await this.getRoadmap();
      const item = items.find((r) => r.id === id);
      if (item && item.upvotes > 0) {
        item.upvotes--;
        item.upvotedBy = item.upvotedBy.filter((s) => s !== sessionId);
        write(KEYS.roadmap, items);
      }
    } else if (type === "bug") {
      const bugs = await this.getBugs();
      const bug = bugs.find((b) => b.id === id);
      if (bug && bug.upvotes > 0) {
        bug.upvotes--;
        bug.upvotedBy = bug.upvotedBy.filter((s) => s !== sessionId);
        write(KEYS.bugs, bugs);
      }
    } else {
      const features = await this.getFeatureRequests();
      const feature = features.find((f) => f.id === id);
      if (feature && feature.upvotes > 0) {
        feature.upvotes--;
        feature.upvotedBy = feature.upvotedBy.filter((s) => s !== sessionId);
        write(KEYS.features, features);
      }
    }
  }

  async hasUpvoted(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<boolean> {
    const upvoted = await this.getUpvotedIds(sessionId, type);
    return upvoted.includes(id);
  }

  // ── Roadmap ──

  async getRoadmap(): Promise<RoadmapItem[]> {
    return read<RoadmapItem[]>(KEYS.roadmap, SEED_ROADMAP);
  }

  // ── Changelog ──

  async getChangelog(): Promise<ChangelogEntry[]> {
    return read<ChangelogEntry[]>(KEYS.changelog, SEED_CHANGELOG);
  }

  // ── FAQ ──

  async getFaq(): Promise<FaqCategory[]> {
    return read<FaqCategory[]>(KEYS.faq, SEED_FAQ);
  }
}
