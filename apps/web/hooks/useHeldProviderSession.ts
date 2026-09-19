"use client";

/**
 * Desktop (Electron) provider-session lifecycle.
 *
 * On mount and provider change, initialises the isolated session partition
 * with full R0-R8 filtering via the main process IPC.
 *
 * Returns `sessionReady` (the webview may mount) AND `appliedEmbedUrl` — the
 * URL the webview should actually show.
 *
 * On the FIRST provider the webview stays gated (hidden) until the main
 * process has configured that provider's rules, closing the startup race.
 *
 * On a provider SWITCH we keep `sessionReady` HIGH and hold `appliedEmbedUrl`
 * at the CURRENT provider until the NEW provider's session has been installed.
 * This is deliberate: dropping `sessionReady` to false would UNMOUNT the
 * singleton <webview> (React gate), tearing down the old guest mid-navigation
 * and emitting `ERR_FAILED (-2)` (the teardown race that broke server
 * switching). And navigating to the new provider before its per-provider
 * rules are installed would feed R3.5 the OLD provider's profile and block the
 * new provider's own scripts. Holding the URL until init resolves avoids both.
 */
import { useEffect, useRef, useState } from "react";
import { getProvider, isDirectProvider } from "@filmsnaps/shared";

export function useHeldProviderSession(
  providerId: string,
  embedUrl: string,
): { sessionReady: boolean; appliedEmbedUrl: string } {
  const isDesktop =
    typeof window !== "undefined" && window.electronAPI?.isDesktop === true;
  const initRef = useRef<string | null>(null);
  const latestRequestRef = useRef<string>("");
  const [appliedEmbedUrl, setAppliedEmbedUrl] = useState(embedUrl);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Mark the newest requested provider synchronously so a stale async init
    // (user switched A→B→A before B's IPC resolved) can detect it's outdated.
    latestRequestRef.current = providerId;

    if (!isDesktop) {
      // Web path — no session to gate on.
      setSessionReady(true);
      setAppliedEmbedUrl(embedUrl);
      return;
    }
    if (!window.electronAPI) return;

    // Direct-video providers never mount an embed webview, so the R0-R8
    // session rules are pure overhead for them — skip the main-process
    // round-trip entirely. Switching to an embed provider later still
    // initializes its session (providerId changes → init runs below).
    const sessionProvider = getProvider(providerId);
    if (sessionProvider && isDirectProvider(sessionProvider)) {
      setSessionReady(true);
      setAppliedEmbedUrl(embedUrl);
      return;
    }

    // Anime chain pre-resolution: no URL yet (identity still resolving or
    // exhausted) — hold the session instead of initializing with "".
    if (!embedUrl) return;

    // Same provider as the currently-initialised one (episode/season/refresh
    // change): rules already installed — apply the new URL immediately.
    if (initRef.current === providerId) {
      setAppliedEmbedUrl(embedUrl);
      setSessionReady(true);
      return;
    }

    // First mount OR provider switch. Keep the webview mounted (sessionReady
    // stays as-is); only swap the applied URL once the new provider's session
    // is installed in main.
    window.electronAPI
      .initProviderSession({ providerId, embedUrl })
      .then(() => {
        // Ignore the resolution if the user already asked for another provider.
        if (latestRequestRef.current !== providerId) return;
        initRef.current = providerId;
        setAppliedEmbedUrl(embedUrl);
        setSessionReady(true);
      })
      .catch((err) => {
        console.warn("[DesktopSession] Failed to init provider session:", err);
        if (latestRequestRef.current !== providerId) return;
        initRef.current = providerId;
        setAppliedEmbedUrl(embedUrl);
        setSessionReady(true); // fail-open for non-security errors
      });
  }, [isDesktop, providerId, embedUrl]);

  return { sessionReady, appliedEmbedUrl };
}
