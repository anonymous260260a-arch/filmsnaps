/**
 * useDownloadTrigger — the one UX-correct way to start a download from any screen.
 *
 * Guarantees (Part 3 of the download overhaul):
 *   - NEVER navigates away: the caller stays on the current screen and gets a
 *     toast ("Download started") instead of a push to /downloads.
 *   - Double-tap safe: an in-flight guard keyed by URL collapses rapid taps
 *     into one enqueue; an already-active same-URL download toasts instead of
 *     creating a duplicate.
 *   - Space is a warning, not a wall: when the requested file (plus everything
 *     already queued) exceeds free space, the user gets a dialog with
 *     "Download anyway" — OS-reported free space can be wrong, space can free
 *     up mid-download, or the user can delete files afterwards. If space truly
 *     runs out mid-write, the native write fails and the task fails cleanly.
 */

import { useCallback, useRef } from "react";
import { Alert, Linking } from "react-native";
import { useDownloadInfra } from "./context";
import { InsufficientSpaceError } from "./errorClassify";
import { downloadToast } from "../../components/DownloadToast";
import { formatBytes } from "./useDownloadList";
import type { DownloadMeta } from "./types";

export interface DownloadTriggerOptions {
  /** Known file size in bytes (from the provider's file listing) for the space check. */
  sizeBytes?: number;
  /** Display badges persisted on the task (quality, size, languages, codec, WEB-DL…). */
  badges?: string[];
}

const ACTIVE_STATUSES = ["pending", "downloading", "paused", "retrying"];

export function useDownloadTrigger() {
  const { enqueue, store } = useDownloadInfra();
  const inFlightUrls = useRef<Set<string>>(new Set());

  const trigger = useCallback(
    async (
      meta: DownloadMeta,
      opts?: DownloadTriggerOptions,
    ): Promise<void> => {
      // ── Double-tap guard ──
      if (inFlightUrls.current.has(meta.url)) return;
      inFlightUrls.current.add(meta.url);
      try {
        // ── Already downloading this exact file? Say so, don't duplicate. ──
        const existing = store
          .getAll()
          .find(
            (t) => t.url === meta.url && ACTIVE_STATUSES.includes(t.status),
          );
        if (existing) {
          downloadToast.info(
            `Already downloading “${existing.title ?? meta.fileName}”`,
          );
          return;
        }

        const enriched: DownloadMeta = {
          ...meta,
          ...(opts?.sizeBytes != null ? { sizeBytes: opts.sizeBytes } : {}),
          ...(opts?.badges?.length ? { badges: opts.badges } : {}),
        };

        const start = (allowInsufficientSpace?: boolean) =>
          enqueue(enriched, { allowInsufficientSpace });

        try {
          await start(false);
        } catch (err) {
          if (!(err instanceof InsufficientSpaceError)) {
            downloadToast.error(
              err instanceof Error ? err.message : "Could not start download",
              4500,
            );
            return;
          }

          // ── Free space: warn, don't hard-block ──
          const proceed = await new Promise<boolean>((resolve) => {
            Alert.alert(
              "Storage might be tight",
              `“${meta.title ?? meta.fileName}” needs about ${formatBytes(
                err.neededBytes,
              )}, but only ${formatBytes(err.freeBytes)} is free (including other queued downloads).\n\nYou can download anyway — the download will pause with a clear error if space actually runs out.`,
              [
                {
                  text: "Cancel",
                  style: "cancel",
                  onPress: () => resolve(false),
                },
                {
                  text: "Download anyway",
                  style: "default",
                  onPress: () => resolve(true),
                },
              ],
            );
          });
          if (!proceed) return;
          await start(true);
        }

        // "Download started" toast with a real action: jump to the manager.
        downloadToast.emit({
          type: "success",
          message: `Download started — ${meta.title ?? meta.fileName}`,
          actionLabel: "View",
          onAction: () => {
            Linking.openURL("filmsnaps://downloads").catch(() => {});
          },
        });
      } finally {
        inFlightUrls.current.delete(meta.url);
      }
    },
    [enqueue, store],
  );

  return { trigger };
}
