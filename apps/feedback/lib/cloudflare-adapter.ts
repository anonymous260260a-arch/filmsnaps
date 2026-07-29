/**
 * CloudflareAdapter — StorageProvider implementation backed by Cloudflare D1.
 *
 * Calls Next.js API routes (app/api/*) which access D1 on the server.
 * All data is server-side: feedback items, votes, roadmap, changelog, FAQ.
 *
 * This adapter requires a visitorId (UUID) and obtains a Turnstile token
 * for spam prevention. If offline, submissions are queued for later.
 */

import type { StorageProvider } from "./storage";
import type {
  BugReport,
  FeatureRequest,
  FeedbackStatus,
  RoadmapItem,
  ChangelogEntry,
  FaqCategory,
  Severity,
} from "./types";
import { getTurnstileToken } from "./turnstile";
import { getIdentityHeaders } from "./fingerprint";
import {
  enqueueSubmission,
  processQueue,
  getPendingCount,
} from "./offline-queue";

// ── Response & Mapping Types ──

interface ApiResponse<T> {
  items?: T[];
  item?: T;
  feedback?: T;
  success?: boolean;
  errors?: string[];
  voteCount?: number;
  hasUpvoted?: boolean;
  action?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ── DB Row → TS Type Mappers ──

function rowToBugReport(row: any): BugReport {
  return {
    id: row.id,
    type: "bug",
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    upvotes: row.upvote_count || row.upvotes || 0,
    upvotedBy: [], // Upvotes are tracked server-side via visitorId
    expectedBehavior: row.expected_behavior || row.expectedBehavior || "",
    actualBehavior: row.actual_behavior || row.actualBehavior || "",
    stepsToReproduce: row.steps_to_reproduce || row.stepsToReproduce || "",
    severity: row.severity as Severity,
    deviceInfo: row.device_info || row.deviceInfo || undefined,
    appVersion: row.app_version || row.appVersion || undefined,
    platform: row.platform || undefined,
    currentPage: row.current_page || row.currentPage || undefined,
  };
}

function rowToFeatureRequest(row: any): FeatureRequest {
  return {
    id: row.id,
    type: "feature",
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    upvotes: row.upvote_count || row.upvotes || 0,
    upvotedBy: [],
    problem: row.problem || "",
    suggestedSolution: row.suggested_solution || row.suggestedSolution || "",
    alternativeSolutions:
      row.alternative_solutions || row.alternativeSolutions || "",
    businessValue: row.business_value || row.businessValue || "",
  };
}

function rowToRoadmapItem(row: any): RoadmapItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    progress: row.progress,
    estimatedRelease:
      row.estimated_release || row.estimatedRelease || undefined,
    upvotes: row.upvote_count || row.upvotes || 0,
    upvotedBy: [],
    relatedFeedbackId:
      row.related_feedback_id || row.relatedFeedbackId || undefined,
  };
}

function rowToChangelogEntry(row: any): ChangelogEntry {
  return {
    version: row.version,
    releaseDate: row.release_date || row.releaseDate,
    changes: (row.changes || []).map((c: any) => ({
      type: c.type,
      description: c.description,
    })),
  };
}

function rowToFaqCategory(row: any): FaqCategory {
  return {
    id: row.id,
    name: row.name,
    items: (row.items || []).map((item: any) => ({
      question: item.question,
      answer: item.answer,
    })),
  };
}

// ── API Fetch Helper ──

interface FetchOptions extends RequestInit {
  skipIdentityHeaders?: boolean;
}

async function apiFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { skipIdentityHeaders, ...fetchOpts } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOpts.headers as Record<string, string>),
  };

  if (!skipIdentityHeaders) {
    const identityHeaders = await getIdentityHeaders();
    Object.assign(headers, identityHeaders);
  }

  const res = await fetch(path, {
    ...fetchOpts,
    headers,
  });

  if (!res.ok) {
    let errMsg = `API error: ${res.status}`;
    try {
      const errBody = await res.json();
      errMsg = errBody.error || errBody.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  return res.json();
}

// ── CloudflareAdapter ──

export class CloudflareAdapter implements StorageProvider {
  private turnstileTokenPromise: Promise<string | null> | null = null;

  constructor() {
    // Pre-fetch Turnstile token on construction
    this.turnstileTokenPromise = getTurnstileToken().catch(() => null);
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const identity = await getIdentityHeaders();
    const token = await this.turnstileTokenPromise;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...identity,
    };
    if (token) {
      headers["turnstile-token"] = token;
    }
    return headers;
  }

  // ── Bugs ──

  async getBugs(): Promise<BugReport[]> {
    try {
      const data = await apiFetch<ApiResponse<BugReport>>(
        "/api/feedback?type=bug",
        {
          skipIdentityHeaders: true,
        },
      );
      return (data.items || []).map(rowToBugReport);
    } catch (err) {
      console.error("[CloudflareAdapter] getBugs failed:", err);
      return [];
    }
  }

  async createBug(
    data: Omit<
      BugReport,
      "id" | "createdAt" | "updatedAt" | "upvotes" | "upvotedBy"
    >,
  ): Promise<BugReport> {
    const headers = await this.getHeaders();

    // Offline detection
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueueSubmission("/api/feedback", { ...data, type: "bug" });
      // Return a local placeholder
      return {
        ...data,
        id: `offline_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        upvotes: 0,
        upvotedBy: [],
      } as BugReport;
    }

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...data,
          type: "bug",
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      return rowToBugReport(result.feedback || result);
    } catch (err: any) {
      // On network error, queue for later
      if (
        err.message?.includes("fetch") ||
        err.message?.includes("NetworkError")
      ) {
        enqueueSubmission("/api/feedback", { ...data, type: "bug" });
        return {
          ...data,
          id: `offline_${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          upvotes: 0,
          upvotedBy: [],
        } as BugReport;
      }
      throw err;
    }
  }

  async updateBugStatus(id: string, status: FeedbackStatus): Promise<void> {
    await apiFetch(`/api/feedback`, {
      method: "PATCH",
      body: JSON.stringify({ id, status }),
    });
  }

  // ── Feature Requests ──

  async getFeatureRequests(): Promise<FeatureRequest[]> {
    try {
      const data = await apiFetch<ApiResponse<FeatureRequest>>(
        "/api/feedback?type=feature",
        {
          skipIdentityHeaders: true,
        },
      );
      return (data.items || []).map(rowToFeatureRequest);
    } catch (err) {
      console.error("[CloudflareAdapter] getFeatureRequests failed:", err);
      return [];
    }
  }

  async createFeatureRequest(
    data: Omit<
      FeatureRequest,
      "id" | "createdAt" | "updatedAt" | "upvotes" | "upvotedBy"
    >,
  ): Promise<FeatureRequest> {
    const headers = await this.getHeaders();

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueueSubmission("/api/feedback", { ...data, type: "feature" });
      return {
        ...data,
        id: `offline_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        upvotes: 0,
        upvotedBy: [],
      } as FeatureRequest;
    }

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...data, type: "feature" }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      return rowToFeatureRequest(result.feedback || result);
    } catch (err: any) {
      if (
        err.message?.includes("fetch") ||
        err.message?.includes("NetworkError")
      ) {
        enqueueSubmission("/api/feedback", { ...data, type: "feature" });
        return {
          ...data,
          id: `offline_${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          upvotes: 0,
          upvotedBy: [],
        } as FeatureRequest;
      }
      throw err;
    }
  }

  async updateFeatureRequestStatus(
    id: string,
    status: FeedbackStatus,
  ): Promise<void> {
    await apiFetch(`/api/feedback`, {
      method: "PATCH",
      body: JSON.stringify({ id, status }),
    });
  }

  // ── Upvoting ──

  async upvote(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<void> {
    await apiFetch("/api/vote", {
      method: "POST",
      body: JSON.stringify({ feedbackId: id, action: "upvote" }),
    });
  }

  async removeUpvote(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<void> {
    await apiFetch("/api/vote", {
      method: "POST",
      body: JSON.stringify({ feedbackId: id, action: "removeUpvote" }),
    });
  }

  async hasUpvoted(
    id: string,
    sessionId: string,
    type: "bug" | "feature" | "roadmap",
  ): Promise<boolean> {
    try {
      const data = await apiFetch<any>(
        `/api/vote?feedbackId=${encodeURIComponent(id)}&visitorId=${encodeURIComponent(sessionId)}`,
        {
          skipIdentityHeaders: true,
        },
      );
      return data.hasUpvoted === true;
    } catch {
      return false;
    }
  }

  // ── Roadmap ──

  async getRoadmap(): Promise<RoadmapItem[]> {
    try {
      const data = await apiFetch<ApiResponse<RoadmapItem>>("/api/roadmap", {
        skipIdentityHeaders: true,
      });
      return (data.items || []).map(rowToRoadmapItem);
    } catch (err) {
      console.error("[CloudflareAdapter] getRoadmap failed:", err);
      return [];
    }
  }

  // ── Changelog ──

  async getChangelog(): Promise<ChangelogEntry[]> {
    try {
      const data = await apiFetch<ApiResponse<ChangelogEntry>>(
        "/api/changelog",
        {
          skipIdentityHeaders: true,
        },
      );
      return (data.items || []).map(rowToChangelogEntry);
    } catch (err) {
      console.error("[CloudflareAdapter] getChangelog failed:", err);
      return [];
    }
  }

  // ── FAQ ──

  async getFaq(): Promise<FaqCategory[]> {
    try {
      const data = await apiFetch<ApiResponse<FaqCategory>>("/api/faq", {
        skipIdentityHeaders: true,
      });
      return (data.items || []).map(rowToFaqCategory);
    } catch (err) {
      console.error("[CloudflareAdapter] getFaq failed:", err);
      return [];
    }
  }
}
