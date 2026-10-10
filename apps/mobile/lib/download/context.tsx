// apps/mobile/lib/download/context.tsx

import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import { DownloadManager } from "./manager";
import { createDownloadStore, type DownloadStore } from "./store";
import { DownloadNotifications } from "./notifications";
import { logger } from "./logger";
import { classifyDownloadError } from "./errorClassify";
import { downloadToast } from "../../components/DownloadToast";
import { useSettings } from "../settings";
import type {
  DownloadMeta,
  DownloadTask,
  ControlAction,
  ControlTarget,
} from "./types";

// ─── Context Shape ───
interface DownloadInfraContext {
  manager: DownloadManager;
  store: DownloadStore;
  enqueue: (
    meta: DownloadMeta,
    opts?: { allowInsufficientSpace?: boolean },
  ) => Promise<string>;
  control: (action: ControlAction, target: ControlTarget) => Promise<void>;
  loaded: boolean;
}

const Ctx = createContext<DownloadInfraContext | null>(null);

// ─── Provider ───
export function DownloadInfraProvider({
  children,
  storeOverride,
}: {
  children: ReactNode;
  storeOverride?: DownloadStore;
}) {
  const managerRef = useRef<DownloadManager | null>(null);
  const storeRef = useRef<DownloadStore | null>(null);
  const initStartedRef = useRef(false);
  const [loaded, setLoaded] = React.useState(false);

  // Initialize singleton manager + store
  if (!managerRef.current) {
    managerRef.current = new DownloadManager({
      maxConcurrent: 3,
      networkPolicy: "any",
      autoRetry: true,
      maxRetries: 3,
      showNativeNotification: true,
    });
  }

  if (!storeRef.current) {
    storeRef.current = storeOverride ?? createDownloadStore();
  }

  const manager = managerRef.current;
  const store = storeRef.current;
  const { settings } = useSettings();

  // ── User-configurable speed limit ──
  // Every new download inherits the setting; changing it live-applies to all
  // currently-running native jobs (additive Android API — iOS no-ops).
  const speedLimitBps = Math.max(
    0,
    Math.round((settings.downloadSpeedLimitKBps ?? 0) * 1024),
  );
  const speedLimitRef = useRef(speedLimitBps);
  speedLimitRef.current = speedLimitBps;

  useEffect(() => {
    manager.applySpeedLimitToActive(speedLimitBps).catch(() => {});
  }, [manager, speedLimitBps]);

  // Expert follow-up: inject store reference so initialize() can push DB corrections
  // into the store via store.upsertMany().
  manager.setStore(store);

  // ─── Load persisted state + initialize manager on mount ───
  useEffect(() => {
    let mounted = true;
    // Q5 fix: guard against double-initialization in React Strict Mode
    // (which mounts → unmounts → remounts in dev). Without this guard,
    // initialization runs twice, and the first async setLoaded(true)
    // races with the second init, leaving loaded=false.
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    (async () => {
      try {
        logger.debug("Context: loading store");
        await store.load(); // hydrate from DB first
        logger.debug("Context: initializing manager");
        await manager.initialize(); // then reconcile against live service state + push
        // corrections into the store via store.upsertMany()
        if (mounted) {
          setLoaded(true);
          logger.debug("Context: initialized — loaded=true");
        }
      } catch (err) {
        logger.error("Context initialization failed:", err);
        if (mounted) setLoaded(true);
      }
    })();

    return () => {
      mounted = false;
      logger.debug("Context: provider unmounting");
    };
  }, [store, manager]);

  // ─── Wire manager events → store mutations ───
  useEffect(() => {
    const unsubProgress = manager.onProgress((p) => {
      store.upsertProgress(
        p.taskId,
        p.receivedBytes,
        p.totalBytes,
        p.speed,
        p.eta,
      );
      // no console.log here — this fires up to several times/sec per active download
    });

    const unsubStatus = manager.onStatus((s) => {
      logger.debug("status change", s.taskId, s.status);
      if (s.removed) {
        store.remove(s.taskId);
        return;
      }

      const task = store.getById(s.taskId);
      if (!task) return;

      store.upsert({
        ...task,
        status: s.status,
        error: s.error,
        fileUri: s.fileUri ?? task.fileUri,
        receivedBytes: s.receivedBytes ?? task.receivedBytes,
        totalBytes: s.totalBytes ?? task.totalBytes,
        updatedAt: Date.now(),
      });

      // Show notification for terminal states. On Android the native service
      // posts rich terminal notifications itself (with progress, actions and
      // deep links) — posting here too would notify the user TWICE. iOS has no
      // native downloader notification layer, so expo-notifications covers it.
      if (s.status === "completed") {
        if (Platform.OS === "ios") {
          DownloadNotifications.showCompleted(
            s.taskId,
            task.title ?? task.fileName,
          ).catch(() => {});
        }
      } else if (s.status === "failed") {
        if (Platform.OS === "ios") {
          DownloadNotifications.showFailed(
            s.taskId,
            task.title ?? task.fileName,
            s.error ?? "Unknown error",
          ).catch(() => {});
        }
        // In-app toast with the same actionable message ("pick another stream",
        // "free up space", …) so failures are visible without opening the shade.
        downloadToast.error(
          `${task.title ?? task.fileName}: ${s.error ?? "Download failed"}`,
          5000,
        );
      } else if (s.status === "cancelled" || s.status === "paused") {
        // State-sync guarantee: a download that is no longer active must never
        // keep a "downloading/complete"-era notification on screen. Dismiss any
        // notification we own for this task (the native foreground summary is
        // removed by the service itself when its job map drains).
        DownloadNotifications.dismissForTask(s.taskId).catch(() => {});
      }
    });

    return () => {
      unsubProgress();
      unsubStatus();
    };
  }, [manager, store]);

  // ─── Enqueue ───
  const enqueue = useCallback(
    async (
      meta: DownloadMeta,
      opts?: { allowInsufficientSpace?: boolean },
    ): Promise<string> => {
      logger.debug(
        "Context enqueue",
        meta.title,
        meta.server,
        meta.quality,
        meta.tmdbId,
      );

      // ── Double-tap / duplicate guard (store level) ──
      // manager.add dedups against the DB, but the store row for a duplicate
      // was created BEFORE that check — a fast double-tap produced two store
      // entries, one of which never reached the DB and sat pending forever.
      // Return the existing active task instead of creating a second one.
      const activeStatuses = ["pending", "downloading", "paused", "retrying"];
      const existing = store
        .getAll()
        .find((t) => t.url === meta.url && activeStatuses.includes(t.status));
      if (existing) {
        logger.debug(
          "Context enqueue: duplicate URL already active, returning existing",
          existing.id,
        );
        return existing.id;
      }

      const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      const task: DownloadTask = {
        ...meta,
        id,
        fileUri: null,
        // Seed the size from the provider's listing so the queued-size space
        // check works before the HTTP Content-Length is known.
        totalBytes: meta.sizeBytes ?? 0,
        // Inherit the user's global speed limit unless the caller pins one.
        speedLimit: meta.speedLimit ?? speedLimitRef.current,
        receivedBytes: 0,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        priority: 1,
        retryCount: 0,
        maxRetries: 3,
      };

      // Immediate UI feedback
      await store.upsert(task);
      logger.debug("Context enqueue: task stored", id);

      // Hand off to manager (non-fatal)
      try {
        await manager.add(task, opts);
        logger.debug("Context enqueue: manager.add succeeded", id);
      } catch (err) {
        // Insufficient-space rejections bubble to the caller (useDownloadTrigger
        // shows the warn + override dialog) — remove the provisional store row.
        if (err instanceof Error && err.name === "InsufficientSpaceError") {
          store.remove(id);
          throw err;
        }
        logger.error("Context enqueue failed:", err);
        await store.upsert({
          ...task,
          status: "failed",
          error:
            err instanceof Error ? err.message : "Failed to start download",
          updatedAt: Date.now(),
        });
      }

      // Notification permission (non-blocking)
      DownloadNotifications.requestPermissions().catch(() => {});

      return id;
    },
    [store, manager],
  );

  // ─── Batch Control ───
  const control = useCallback(
    async (action: ControlAction, target: ControlTarget) => {
      let ids: string[] = [];

      if (typeof target === "string") {
        ids = [target];
      } else if (Array.isArray(target)) {
        ids = target;
      } else {
        // Status filter
        const statuses = Array.isArray(target.status)
          ? target.status
          : [target.status!];
        const tasks = store.getAll().filter((t) => statuses.includes(t.status));
        ids = tasks.map((t) => t.id);
      }

      logger.debug("Context control", action, ids.length, ids.slice(0, 3));
      for (const id of ids) {
        try {
          switch (action) {
            case "pause":
              await manager.pause(id);
              break;
            case "resume":
              await manager.resume(id);
              break;
            case "cancel":
              await manager.cancel(id);
              break;
            case "retry":
              await manager.retry(id);
              break;
            case "remove":
              await manager.remove(id);
              break;
          }
          logger.debug("Context control done", action, id);
        } catch (err) {
          logger.error("Context control failed", action, id, err);
        }
      }
    },
    [manager, store],
  );

  return (
    <Ctx.Provider value={{ manager, store, enqueue, control, loaded }}>
      {children}
    </Ctx.Provider>
  );
}

// ─── Hook ───
export function useDownloadInfra(): DownloadInfraContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useDownloadInfra must be used within DownloadInfraProvider",
    );
  }
  return ctx;
}

// ─── NEW: Media download state hook ───
import type {
  MediaDownloadState,
  MediaDownloadSummary,
  SeasonDownloadSummary,
  DownloadQuality,
  SmartDownloadConfig,
  DownloadServer,
} from "./types";
import { QUALITY_TO_SERVER, DEFAULT_SMART_CONFIG } from "./types";
import { useNetInfo } from "@react-native-community/netinfo";
import * as Haptics from "expo-haptics";

/**
 * Hook that aggregates download state for a specific movie/TV title.
 * Used by detail pages to show download status without navigating away.
 */
export function useMediaDownloadState(
  mediaType: "movie" | "tv",
  tmdbId: string,
): MediaDownloadSummary {
  const { store } = useDownloadInfra();

  // We read from store reactively — the store uses useSyncExternalStore internally
  // but since we're outside React tree, we re-render via the store subscription.
  // Use React.useSyncExternalStore for proper reactive subscription.
  const tasks = React.useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getAll(),
  );

  return React.useMemo(() => {
    const relevant = tasks.filter(
      (t) => t.tmdbId === tmdbId && t.mediaType === mediaType,
    );

    if (relevant.length === 0) {
      return {
        state: "none" as MediaDownloadState,
        totalTasks: 0,
        completedTasks: 0,
        activeTasks: 0,
        failedTasks: 0,
        totalBytes: 0,
        receivedBytes: 0,
      };
    }

    const completed = relevant.filter((t) => t.status === "completed");
    const active = relevant.filter(
      (t) =>
        t.status === "downloading" ||
        t.status === "pending" ||
        t.status === "retrying",
    );
    const failed = relevant.filter((t) => t.status === "failed");
    const paused = relevant.filter((t) => t.status === "paused");

    let state: MediaDownloadState;
    if (completed.length === relevant.length) {
      state = "completed";
    } else if (active.length > 0) {
      state = "downloading";
    } else if (failed.length > 0 && completed.length === 0) {
      state = "failed";
    } else if (completed.length > 0) {
      state = "partial";
    } else {
      state = "none";
    }

    const totalBytes = relevant.reduce((s, t) => s + t.totalBytes, 0);
    const receivedBytes = relevant.reduce((s, t) => s + t.receivedBytes, 0);

    // TV: build per-season summary
    let seasons: SeasonDownloadSummary[] | undefined;
    if (mediaType === "tv") {
      const seasonMap = new Map<
        number,
        {
          total: number;
          downloaded: number;
          downloading: number;
          failed: number;
        }
      >();
      for (const t of relevant) {
        const sn = t.season ?? 1;
        const entry = seasonMap.get(sn) ?? {
          total: 0,
          downloaded: 0,
          downloading: 0,
          failed: 0,
        };
        entry.total++;
        if (t.status === "completed") entry.downloaded++;
        if (t.status === "downloading" || t.status === "pending")
          entry.downloading++;
        if (t.status === "failed") entry.failed++;
        seasonMap.set(sn, entry);
      }
      seasons = Array.from(seasonMap.entries())
        .map(([seasonNumber, s]) => ({
          seasonNumber,
          totalEpisodes: s.total,
          downloadedEpisodes: s.downloaded,
          downloadingEpisodes: s.downloading,
          failedEpisodes: s.failed,
        }))
        .sort((a, b) => a.seasonNumber - b.seasonNumber);
    }

    return {
      state,
      totalTasks: relevant.length,
      completedTasks: completed.length,
      activeTasks: active.length + paused.length,
      failedTasks: failed.length,
      totalBytes,
      receivedBytes,
      seasons,
    };
  }, [tasks, tmdbId, mediaType]);
}

/**
 * Hook that provides one-tap "smart download" that auto-picks quality
 * based on network connection (WiFi = HD, cellular = small).
 */
export function useSmartDownload() {
  const { enqueue } = useDownloadInfra();
  const netInfo = useNetInfo();

  const resolveQuality = React.useCallback(
    (config: SmartDownloadConfig = DEFAULT_SMART_CONFIG): DownloadQuality => {
      const isCellular = netInfo.type === "cellular";
      if (isCellular && config.autoQualityOnCellular) {
        return "small";
      }
      return config.preferredQuality;
    },
    [netInfo.type],
  );

  const smartDownload = React.useCallback(
    async (
      meta: Omit<import("./types").DownloadMeta, "server">,
      quality?: DownloadQuality,
    ): Promise<string> => {
      const resolvedQuality = quality ?? resolveQuality();
      const server: DownloadServer = QUALITY_TO_SERVER[resolvedQuality];

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
        () => {},
      );

      const id = await enqueue({
        ...meta,
        server,
        quality: resolvedQuality,
      });

      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      return id;
    },
    [enqueue, resolveQuality],
  );

  return { smartDownload, resolveQuality };
}

/**
 * Hook that returns the download status of a specific TV episode.
 */
export function useEpisodeDownloadStatus(
  tmdbId: string,
  season: number,
  episode: number,
): { status: import("./types").DownloadStatus | null } {
  const { store } = useDownloadInfra();

  const tasks = React.useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getAll(),
  );

  return React.useMemo(() => {
    const task = tasks.find(
      (t) =>
        t.tmdbId === tmdbId &&
        t.season === season &&
        t.episode === episode &&
        t.status !== "cancelled",
    );
    return { status: task?.status ?? null };
  }, [tasks, tmdbId, season, episode]);
}
