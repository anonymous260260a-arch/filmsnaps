import type {
  BugReport,
  FeatureRequest,
  FeedbackStatus,
  RoadmapItem,
  ChangelogEntry,
  FaqCategory,
} from "./types";

/**
 * StorageProvider — abstract interface for all persistence.
 *
 * Swap implementations without touching UI code:
 * - LocalStorageAdapter   → browser localStorage (default, no backend)
 * - GitHubAdapter          → GitHub Issues API (future)
 * - SupabaseAdapter        → Supabase (future)
 * - MongoDBAdapter         → MongoDB (future)
 */
export interface StorageProvider {
  // ── Bugs ──
  getBugs(): Promise<BugReport[]>;
  createBug(
    data: Omit<
      BugReport,
      "id" | "createdAt" | "updatedAt" | "upvotes" | "upvotedBy"
    >,
  ): Promise<BugReport>;
  updateBugStatus(id: string, status: FeedbackStatus): Promise<void>;

  // ── Feature Requests ──
  getFeatureRequests(): Promise<FeatureRequest[]>;
  createFeatureRequest(
    data: Omit<
      FeatureRequest,
      "id" | "createdAt" | "updatedAt" | "upvotes" | "upvotedBy"
    >,
  ): Promise<FeatureRequest>;
  updateFeatureRequestStatus(id: string, status: FeedbackStatus): Promise<void>;

  // ── Upvoting ──
  upvote(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<void>;
  removeUpvote(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<void>;
  hasUpvoted(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<boolean>;

  // ── Roadmap ──
  getRoadmap(): Promise<RoadmapItem[]>;

  // ── Changelog ──
  getChangelog(): Promise<ChangelogEntry[]>;

  // ── FAQ ──
  getFaq(): Promise<FaqCategory[]>;
}
