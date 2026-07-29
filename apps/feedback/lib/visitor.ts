/**
 * Visitor ID — persistent anonymous UUID stored in localStorage.
 * Replaces the old getSessionId() with a UUID v4 format.
 * Same pattern but better ID format for server-side tracking.
 */

const VISITOR_ID_KEY = "@filmsnaps/feedback/visitor-id";

export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id =
        crypto.randomUUID?.() ??
        `vis_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return `vis_fallback_${Date.now()}`;
  }
}

export function clearVisitorId(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(VISITOR_ID_KEY);
  } catch {}
}
