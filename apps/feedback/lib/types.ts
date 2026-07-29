// ── Status & Severity ──

export type FeedbackStatus =
  | "open"
  | "planned"
  | "in-progress"
  | "completed"
  | "declined";

export type Severity = "critical" | "high" | "medium" | "low";

export type FeedbackType = "bug" | "feature";

// ── Base ──

export interface BaseFeedback {
  id: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  upvotes: number;
  upvotedBy: string[];
}

// ── Bug Report ──

export interface BugReport extends BaseFeedback {
  type: "bug";
  expectedBehavior: string;
  actualBehavior: string;
  stepsToReproduce: string;
  severity: Severity;
  deviceInfo?: string;
  appVersion?: string;
  platform?: string;
  currentPage?: string;
  screenshots?: string[];
}

// ── Feature Request ──

export interface FeatureRequest extends BaseFeedback {
  type: "feature";
  problem: string;
  suggestedSolution: string;
  alternativeSolutions: string;
  businessValue: string;
}

// ── Roadmap ──

export type RoadmapStatus = "planned" | "in-progress" | "completed";

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  progress: number;
  estimatedRelease?: string;
  upvotes: number;
  upvotedBy: string[];
  relatedFeedbackId?: string;
}

// ── Changelog ──

export type ChangeType = "feature" | "fix" | "improvement" | "security";

export interface ChangelogEntry {
  version: string;
  releaseDate: string;
  changes: { type: ChangeType; description: string }[];
}

// ── FAQ ──

export interface FaqCategory {
  id: string;
  name: string;
  items: { question: string; answer: string }[];
}
