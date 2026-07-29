/**
 * Feedback portal URL helper.
 * Returns the deployed URL of the Feedback Portal app.
 *
 * The URL is configurable via:
 *   1. EXPO_PUBLIC_FEEDBACK_URL env var (for overriding in builds)
 *   2. Default: appending "feedback." to the web URL prefix
 */

import Constants from "expo-constants";

const FALLBACK_FEEDBACK_URL =
  "https://filmsnaps-feedback.anonymous260260a.workers.dev";

/**
 * Returns the URL of the deployed feedback portal.
 */
export function getFeedbackPortalUrl(): string {
  const envUrl = Constants.expoConfig?.extra?.feedbackUrl as string | undefined;
  if (envUrl) return envUrl;

  // Try to derive from the main web URL
  const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
  if (webUrl) {
    try {
      const url = new URL(webUrl);
      return `https://feedback.${url.hostname}`;
    } catch {}
  }

  return FALLBACK_FEEDBACK_URL;
}
