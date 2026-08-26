// apps/mobile/lib/download/context.tsx

import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { DownloadManager } from "./manager";
import { createDownloadStore, type DownloadStore } from "./store";
import { DownloadNotifications } from "./notifications";
import { logger } from "./logger";
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
  enqueue: (meta: DownloadMeta) => Promise<string>;
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

      // Show notification for terminal states
      if (s.status === "completed") {
        DownloadNotifications.showCompleted(
          s.taskId,
          task.title ?? task.fileName,
        ).catch(() => {});
      } else if (s.status === "failed") {
        DownloadNotifications.showFailed(
          s.taskId,
          task.title ?? task.fileName,
          s.error ?? "Unknown error",
        ).catch(() => {});
      }
    });

    return () => {
      unsubProgress();
      unsubStatus();
    };
  }, [manager, store]);

  // ─── Enqueue ───
  const enqueue = useCallback(
    async (meta: DownloadMeta): Promise<string> => {
      logger.debug(
        "Context enqueue",
        meta.title,
        meta.server,
        meta.quality,
        meta.tmdbId,
      );
      const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      const task: DownloadTask = {
        ...meta,
        id,
        fileUri: null,
        totalBytes: 0,
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
        await manager.add(task);
        logger.debug("Context enqueue: manager.add succeeded", id);
      } catch (err) {
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

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const id = await enqueue({
        ...meta,
        server,
        quality: resolvedQuality,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
