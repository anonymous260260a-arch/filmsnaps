/**
 * Privacy-conscious fingerprinting using only non-invasive signals.
 *
 * Signals used: screen w/h, timezone, language, platform, color depth.
 * Signals NOT used: canvas, WebGL, fonts, battery, audio — too invasive.
 *
 * The fingerprint is a one-way hash — it cannot be reversed to original signals.
 */

import { getVisitorId } from "./visitor";

// Simple SHA-256 hash using Web Crypto API
async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a privacy-conscious fingerprint hash.
 * Returns a 32-char hex string.
 */
export async function getFingerprint(): Promise<string> {
  if (typeof window === "undefined") return "";

  try {
    const signals: Record<string, any> = {
      screenWidth: screen.width,
      screenHeight: screen.height,
      colorDepth: screen.colorDepth,
      timezoneOffset: new Date().getTimezoneOffset(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      platform: (navigator as any).platform || "",
      hardwareConcurrency: navigator.hardwareConcurrency || "",
      // NOT included: canvas fingerprint, WebGL, fonts, battery, audio
    };

    const json = JSON.stringify(signals);
    const hash = await sha256(json);
    return hash.slice(0, 32);
  } catch {
    // Fallback: use visitor ID as fingerprint
    return getVisitorId().slice(0, 32);
  }
}

/**
 * Get combined visitor identity information for API headers.
 */
export async function getIdentityHeaders(): Promise<{
  "x-visitor-id": string;
  "x-fingerprint": string;
}> {
  const visitorId = getVisitorId();
  const fingerprint = await getFingerprint();
  return {
    "x-visitor-id": visitorId,
    "x-fingerprint": fingerprint,
  };
}
