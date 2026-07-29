# DOCUMENT A — FULL CONTEXT EXPERT CONSULTATION

## Filmsnaps Download Engine — Complete Architecture & Failure Analysis

---

## ⚠️ REQUEST

We need you to **design and implement a bulletproof Android download engine** for our React Native (Expo SDK 55) app. The current system is broken — pause doesn't actually pause, resume sends corrupted byte offsets, the stack overflows from repeated pause calls, progress events go missing, and the entire system has become an unmaintainable tangle of patches.

**DO NOT suggest incremental fixes. Give us a complete replacement architecture.**

---

## WHAT THIS APP IS

**Filmsnaps** is a media streaming app (movies & TV shows). Users browse content in-app, tap "Download" on a movie or episode, and the app downloads it to their device for offline playback. The download URLs point to:

- **Falix server**: Hosted on Hugging Face Spaces (`download-falix-falixmovies-backend-hf.hf.space/dl/...`)
- **Nxsha server**: Alternative media host
- **Alt-dl server**: Fallback

The download URLs are ephemeral — they can expire. Files are `.mkv` sourced, saved as `.mp4`. The app is **not on the Play Store** — it's distributed via sideloading/APK.

---

## TECHNOLOGY STACK

| Layer          | Technology                      | Version                                   |
| -------------- | ------------------------------- | ----------------------------------------- |
| Framework      | React Native via Expo           | SDK 55                                    |
| React Native   | react-native                    | 0.83.6                                    |
| React          | react                           | 19.2.0                                    |
| Language       | TypeScript                      | 5.x                                       |
| Native Android | Kotlin                          | Android DownloadManager API               |
| Native iOS     | Swift                           | URLSessionDownloadTask                    |
| Expo Router    | expo-router                     | 55.x                                      |
| SQLite         | expo-sqlite                     | 55.x                                      |
| File System    | expo-file-system                | 55.x (modern API: File, Directory, Paths) |
| Notifications  | expo-notifications              | 55.x                                      |
| Networking     | @react-native-community/netinfo | 11.x                                      |
| Styling        | NativeWind (TailwindCSS)        | 4.x                                       |
| Plugin System  | @expo/config-plugins            | (prebuild-time Kotlin injection)          |

---

## CURRENT ARCHITECTURE

```
UI Components (downloads.tsx, DownloadSheet, etc.)
    ⇅ (React hooks via useSyncExternalStore)
Download Hooks (useDownloadList, useDownload, useEpisodeDownloads, useDownloadQueue)
    ⇅
DownloadInfraProvider (context.tsx — manager + store + enqueue + control)
    ├── In-Memory Store (store.ts) — synchronous, subscribe/notify pattern
    │       ⇅ (fire-and-forget persistence)
    │   DownloadDatabase (database.ts) — SQLite via expo-sqlite
    │
    └── DownloadManager (manager.ts) — orchestrator: queue, pause/resume/cancel, retry, network policy
            ⇅ (calls adapter)
        NativeDownloaderAdapter (nativeAdapter.ts) — bridges JS ↔ Kotlin/Swift
            ⇅
        NativeDownloadBridge (nativeBridge.ts) — NativeModules.FilmsnapsDownloader
            ⇅
        FilmsnapsDownloadModule.kt (Kotlin — Android DownloadManager wrapper)
```

---

## KNOWN BUGS (💀 All Unfixed Despite Many Patches)

### 💀 BUG 1: Pause Doesn't Actually Pause (Stack Overflow)

**Symptom**: User taps Pause, ~200 identical `[DL] Manager pause:` logs flood, then `Maximum call stack size exceeded`.
**Root cause**: The "Pause All" button triggers `control("pause", { status: "downloading" })` which filters store tasks by `status === 'downloading'`. But pause never transitions the task to 'paused' successfully (native call silently fails or the event loop piles up), so the button keeps finding the same task and calling pause() again. Each call starts a new `control()` → `manager.pause()` cycle. After ~200 rapid re-entrant calls, the stack overflows.
**Real root cause**: `nativeAdapter.ts:createInstance().pause()` **deletes `activeCallbacks` BEFORE calling native pause** (`this.activeCallbacks.delete(id)` then `NativeDownloadBridge.pause(id)`). If the native pause doesn't fire JS events back in the expected way, or the callback deletion happens too early, the manager's `await instance.pause()` resolves before the native module actually pauses, so `emitStatus` never fires → store never gets `status='paused'` → "Pause All" sees the task still as `'downloading'` → calls pause again.

### 💀 BUG 2: Resume Sends Corrupted Byte Offset (`95236469603970`)

**Symptom**: On resume, `resumeData` reads as `"95236469603970"` — this is `"9523646" + "9603970"` (string concatenation of two numbers).
**Root cause**: `resumeData` is stored as INTEGER in SQLite sometimes, read back as a Number by `rowToTask`, then passed to `store.upsert()` which fires `db.update()` with a string somewhere else. The type mismatch between Number and String through expo-sqlite's parameter binding causes concatenation instead of addition.

### 💀 BUG 3: Resume Downloads Don't Actually Progress

**Symptom**: After resume, progress shows the same offset bytes forever. No new bytes are downloaded.
**Root cause**:

- **Resume ALWAYS DELETES the partial file** in `resumeDownload()` (Kotlin: `if (existingFile.exists()) existingFile.delete()`). So even with a correct Range header, there's no partial file to append to, and DownloadManager starts from byte 0 on a new file.
- Even if the file is kept, Android DownloadManager **does NOT support Range headers for resume** — it ignores them and re-downloads from scratch. The Range header is set on the request but `DownloadManager.Request` doesn't support resumable downloads natively.

### 💀 BUG 4: Progress Events Emit 0 Bytes for Resumed Tasks

**Symptom**: `Adapter progress: task=X bytes=0/803358799` shows on first event after resume even though 26MB was already downloaded.
**Root cause**: The Kotlin cursor reports `COLUMN_BYTES_DOWNLOADED_SO_FAR=0` for a new DownloadManager task starting from scratch (because the file was deleted). The adapter adds the resume offset (26MB + 0 = 26MB) but this doesn't match the actual situation where no bytes were actually kept.

### 💀 BUG 5: `getInfoAsync` Throws at Runtime (SDK 55 Breaking API)

**Symptom**: `FileSystem.getInfoAsync(...)` throws `TypeError: Cannot read properties of undefined (reading 'getInfoAsync')` in SDK 55.
**Root cause**: Expo SDK 55 removed the default export. `import * as FileSystem from 'expo-file-system'` no longer has `getInfoAsync`. Must use `import { File, Directory, Paths } from 'expo-file-system'` (modern) or `import { getInfoAsync } from 'expo-file-system/legacy'` (legacy).

### 💀 BUG 6: Double Extension (`.mkv.mp4`)

**Symptom**: Files get saved as `Movie-720p.mkv.mp4` — double extension.
**Root cause**: `DownloadMeta.fileName` already contains the extension (from the scrape: `"House of the Dragon-720p.mkv"`), and then `task.extension || "mp4"` is appended, producing `.mkv.mp4`.

### 💀 BUG 7: `documentDirectory` is null

**Symptom**: On some Android devices with SDK 55, `documentDirectory` from `expo-file-system` can be null, producing paths like `"undefinedFilmsnaps/"`.

---

## THE PROBLEM STATEMENT

Android `DownloadManager` is fundamentally not designed for:

1. Reliable pause/resume (it stops progress when you call `remove()`, Range headers are ignored)
2. Real-time progress polling (we use a 500ms Handler+Runnable cursor poll — janky)
3. File-level resume (DownloadManager doesn't support appending to partial files)

**You have two options:**

### Option A: Replace Android DownloadManager with Custom Download Service

Implement a proper `ForegroundService` in Kotlin that uses `URLConnection` or OkHttp with:

- Real HTTP Range-request resume (partial file + append mode)
- True pause (just stop reading the InputStream, save the offset)
- Accurate byte-level progress (from InputStream.available / bytes-read counter, not cursor polling)
- Background notification with real progress percent
- Thread-safe pause/resume with proper mutex/lock

### Option B: Keep DownloadManager But Fix All The Wrapping

Massively simpler but DownloadManager fundamentally doesn't support true pause/resume well. You'd need to:

- Accept that "pause" = "cancel + save offset", "resume" = "start new task with Range header (which DownloadManager ignores)"
- Use a custom file downloader for the actual byte fetching, wrapping DownloadManager only for notification/simple cases

**We strongly prefer Option A — a proper native download service.**

---

## REQUIRED FEATURES

The new engine must handle ALL of these reliably:

1. **Fresh download**: Start from URL, save to destination file, track progress
2. **Pause**: Stop downloading immediately, save byte offset. MUST work every time on first tap.
3. **Resume**: Continue from saved offset using HTTP Range header. Must verify partial file exists and has correct size.
4. **Cancel**: Kill download, delete partial file, clean up all state
5. **Batch Pause/Resume/Cancel**: Operate on all active/paused tasks
6. **Queue**: Max 3 concurrent downloads, queue the rest, auto-start when a slot opens
7. **Progress**: Real-time byte-level progress (every 300-400ms at most), speed + ETA
8. **Completion**: Verify file exists on disk, mark complete
9. **Error handling**: Auto-retry with exponential backoff (5s → 15s → 60s), max 3 retries
10. **Network awareness**: Pause all on connectivity loss, auto-resume when reconnected
11. **Notifications**: Show native notification with real progress, dismiss on complete/fail
12. **Storage management**: Track used/free space, evict old downloads
13. **App restart recovery**: On cold start, recover "downloading" tasks as "paused", verify OS-completed files
14. **SQLite persistence**: Full task metadata in SQLite, sync with in-memory store
15. **React integration**: useSyncExternalStore hooks for reactive UI, no stale reads
16. **Thread safety**: No re-entrancy bugs, no stack overflows, no race conditions
17. **File naming**: Single extension (no `.mkv.mp4`), sanitized for native filesystem
18. **Dead task suppression**: Late native completions for cancelled tasks must be ignored

---

## FILES INCLUDED IN THIS PACKAGE

All source files below are in the [`lib/download/`] directory of a monorepo at `apps/mobile/lib/download/`.

### Architecture Files

| File               | Purpose                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `adapter.ts`       | `IDownloaderAdapter` interface + `DownloadInstance` interface                |
| `types.ts`         | All shared types: `DownloadTask`, `DownloadStatus`, `DownloadProgress`, etc. |
| `index.ts`         | Public barrel exports                                                        |
| `nativeBridge.ts`  | `NativeModules.FilmsnapsDownloader` bridge wrapper + event subscriptions     |
| `fileNameUtils.ts` | `buildFileName()`, `sanitizeForNative()` — solves double-extension bug       |
| `fsCompat.ts`      | SDK 55 file-system compatibility layer (File/Directory/Paths modern API)     |
| `utils.ts`         | Shared utilities: `toSafeNumber()`, `sanitizeResumeData()`, `formatBytes()`  |
| `migration.ts`     | One-time migration from old download system                                  |

### Core Engine Files

| File                | Lines | Purpose                                                                      |
| ------------------- | ----- | ---------------------------------------------------------------------------- |
| `store.ts`          | 147   | Synchronous in-memory store with subscribe/notify pattern                    |
| `database.ts`       | 360   | SQLite persist layer via expo-sqlite                                         |
| `manager.ts`        | 1160  | **Main orchestrator** — queue, pause/resume/cancel, retry, progress, network |
| `nativeAdapter.ts`  | 370   | JS bridge to native Kotlin/Swift modules                                     |
| `context.tsx`       | 257   | React Context provider: wires manager + store + enqueue + control            |
| `networkPolicy.ts`  | 81    | NetInfo-based connectivity aware policy                                      |
| `notifications.ts`  | 93    | expo-notifications wrapper                                                   |
| `storageManager.ts` | 131   | Disk space management                                                        |

### Hook Files

| File                     | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `useDownloadList.ts`     | Subscribe to all downloads grouped by status |
| `useDownload.ts`         | Single-task reactive hook                    |
| `useDownloadQueue.ts`    | Queue state monitor                          |
| `useEpisodeDownloads.ts` | TV season batch download management          |

### Native Module Files

| File                                    | Lines | Purpose                                                                                     |
| --------------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `FilmsnapsDownloadModule.kt` (android/) | 502   | Kotlin module in **android/app/src/main/java/**                                             |
| `FilmsnapsDownloadModule.kt` (plugin/)  | 508   | **Plugin copy** — copied into android/ during prebuild                                      |
| `FilmsnapsDownloadPackage.kt`           | 17    | ReactPackage registration                                                                   |
| `FilmsnapsDownloader.swift`             | —     | iOS Swift module                                                                            |
| `withAndroidDownloader.js`              | 104   | Expo config plugin — writes Kotlin files + patches MainApplication.kt + AndroidManifest.xml |
| `withIOSDownloader.js`                  | —     | iOS config plugin                                                                           |
| `index.js` (plugin/)                    | 15    | Plugin entry point                                                                          |

### Configuration Files

- `package.json` (apps/mobile) — see attached
- `app.json` (apps/mobile) — Expo config

---

## FULL SOURCE CODE

### [`manager.ts`](apps/mobile/lib/download/manager.ts) — 1160 lines — THE CORE

```typescript
// apps/mobile/lib/download/manager.ts
// KEY CHANGES:
// - processQueue uses shared-promise pattern (no re-entrancy)
// - resume() reuses existing native task handle
// - initialize() is explicit (not fire-and-forget constructor)
// - Completion guard prevents double-fire
//
// BUG FIXES applied (from EXPERT_BUGFIX_3.md):
//   A: getInfoAsync from modern API throws → use fsCompat
//   B: double extension (.mkv.mp4) → use buildFileName
//   C: path mismatch → handleNativeDone uses native filePath
//   E: pause writes 0 bytes → stat file on disk
//   F: emitStatus missing fileUri → include it in startDownload
//   Q6: cancel race → DB mark first, handleNativeDone checks status

import { DownloadDatabase } from "./database";
import { NativeDownloaderAdapter } from "./nativeAdapter";
import { NetworkAwarePolicy } from "./networkPolicy";
import { StorageManager } from "./storageManager";
import type { DownloadInstance } from "./adapter";
import type {
  DownloadTask,
  DownloadProgress,
  StatusChange,
  DownloadConfig,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import {
  getInfoAsync,
  deleteFile,
  ensureDirectory,
  getNativeDownloadDir,
} from "./fsCompat";
import { buildFileName, sanitizeForNative } from "./fileNameUtils";

// ─── Constants ───
const RETRY_DELAYS = [5_000, 15_000, 60_000];
const DB_WRITE_INTERVAL = 3_000;
const PROGRESS_EMIT_INTERVAL = 400;

// ─── Speed Tracker ───
class SpeedTracker {
  private samples: Array<{ time: number; bytes: number }> = [];
  private windowMs = 5_000;

  update(bytes: number): void {
    const now = Date.now();
    this.samples.push({ time: now, bytes });
    const cutoff = now - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }
  }

  getSpeed(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const elapsedSec = (last.time - first.time) / 1000;
    if (elapsedSec <= 0.1) return 0;
    return Math.max(0, Math.round((last.bytes - first.bytes) / elapsedSec));
  }

  getEta(remainingBytes: number): number {
    const speed = this.getSpeed();
    if (speed <= 0) return 0;
    return Math.round(remainingBytes / speed);
  }

  reset(): void {
    this.samples = [];
  }
}

// ─── Event Types ───
type ProgressListener = (p: DownloadProgress) => void;
type StatusListener = (s: StatusChange) => void;
type QueueListener = (queueLength: number, activeCount: number) => void;

// ─── Manager ───
export class DownloadManager {
  private adapter: NativeDownloaderAdapter;
  private networkPolicy: NetworkAwarePolicy;
  private storage: StorageManager;
  private config: DownloadConfig;

  private queue: string[] = [];
  private activeInstances = new Map<string, DownloadInstance>();
  private speedTrackers = new Map<string, SpeedTracker>();
  private liveReceived = new Map<string, number>();
  private liveTotal = new Map<string, number>();

  // ─── Shared-promise queue lock ───
  private processQueuePromise: Promise<void> | null = null;

  private initialized = false;
  private pausedForNetwork = new Set<string>();

  // ─── FIX 5: Debounce timer for network policy spam ───
  private networkDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private progressListeners = new Set<ProgressListener>();
  private statusListeners = new Set<StatusListener>();
  private queueListeners = new Set<QueueListener>();

  constructor(config?: Partial<DownloadConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.adapter = new NativeDownloaderAdapter();
    this.networkPolicy = new NetworkAwarePolicy(this.config.networkPolicy);
    this.storage = new StorageManager();

    // Network change handler (FIX 5: debounced to avoid 5x spam on startup)
    this.networkPolicy.onChange((canDownload, isWifi) => {
      if (this.networkDebounceTimer) {
        clearTimeout(this.networkDebounceTimer);
      }
      this.networkDebounceTimer = setTimeout(() => {
        this.networkDebounceTimer = null;
        if (!canDownload) {
          this.pauseAllForNetwork();
        } else {
          this.resumeNetworkPaused();
          this.processQueue();
        }
      }, 1000);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // INITIALIZATION (explicit, awaited by context)
  // ═══════════════════════════════════════════════════════════

  /**
   * Must be called once before any downloads start.
   * The context provider awaits this in useEffect.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    console.log(
      `[DL] Manager initialize start — active=${this.activeInstances.size} queue=${this.queue.length}`,
    );

    try {
      // 1. Mark stale DB tasks (downloading/retrying from previous session → paused)
      const staleCount = await DownloadDatabase.recoverStaleTasks();
      if (staleCount > 0) {
        console.log(`[DL] Manager: marked ${staleCount} stale tasks as paused`);
      }

      // 2. Check for OS-completed downloads (file exists but DB says downloading)
      const allTasks = await DownloadDatabase.getAll();
      console.log(`[DL] Manager: loaded ${allTasks.length} tasks from DB`);
      for (const task of allTasks) {
        if (task.status !== "downloading" && task.status !== "retrying")
          continue;

        // Bug B fix: use buildFileName
        // Bug 3 fix: pass uniqueSuffix to prevent file name collisions
        const uniqueSuffix =
          task.season != null && task.episode != null
            ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
            : task.id.slice(0, 20);
        const fileName = sanitizeForNative(
          buildFileName(task.fileName, task.extension, uniqueSuffix),
        );
        const filePath = this.adapter.getDestinationPath(fileName);
        console.log(
          `[DL] Manager: checking stale task ${task.id} status=${task.status} filePath=${filePath}`,
        );

        // Bug A fix: use fsCompat.getInfoAsync (never throws)
        const info = await getInfoAsync(filePath);
        console.log(
          `[DL] Manager: file check for ${task.id} — exists=${info.exists} size=${info.size}`,
        );
        if (info.exists && info.size > 0) {
          // OS completed it while app was dead
          console.log(
            `[DL] Manager: OS-completed file found for ${task.id} — marking completed`,
          );
          await DownloadDatabase.update({
            id: task.id,
            status: "completed",
            fileUri: filePath,
            totalBytes: info.size,
            receivedBytes: info.size,
            resumeData: null,
            updatedAt: Date.now(),
          });
          this.emitStatus({
            taskId: task.id,
            status: "completed",
            fileUri: filePath,
            receivedBytes: info.size ?? undefined,
            totalBytes: info.size ?? undefined,
          });
          continue;
        }

        // File doesn't exist or is empty — mark paused for user to resume
        console.log(
          `[DL] Manager: no file found for ${task.id} — marking paused`,
        );
        await DownloadDatabase.update({
          id: task.id,
          status: "paused",
          updatedAt: Date.now(),
        });
      }

      // 3. Process any pending tasks in the queue
      const pendingTasks = await DownloadDatabase.getByStatus("pending");
      console.log(
        `[DL] Manager: ${pendingTasks.length} pending tasks to queue`,
      );
      for (const task of pendingTasks) {
        if (!this.queue.includes(task.id)) {
          this.queue.push(task.id);
        }
      }
      this.notifyQueue();
      this.processQueue();
      console.log(
        `[DL] Manager initialize done — active=${this.activeInstances.size} queue=${this.queue.length}`,
      );
    } catch (err) {
      console.error(`[DL] Manager initialize error:`, err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ADD
  // ═══════════════════════════════════════════════════════════

  async add(task: DownloadTask): Promise<string> {
    // Q6 fix: exclude cancelled/failed/completed from dedup
    const existing = await DownloadDatabase.getByMediaId(task.tmdbId ?? "");
    const duplicate = existing.find(
      (t) =>
        t.url === task.url &&
        t.status !== "completed" &&
        t.status !== "cancelled" &&
        t.status !== "failed",
    );
    if (duplicate) {
      console.log(
        `[DL] Manager add: duplicate found — returning existing id=${duplicate.id} status=${duplicate.status}`,
      );
      return duplicate.id;
    }

    // ── Generate task ID ──
    const id = task.id;

    // Build file path for logging
    const uniqueSuffix =
      task.season != null && task.episode != null
        ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
        : id.slice(0, 20);
    const fileName = sanitizeForNative(
      buildFileName(task.fileName, task.extension ?? "mp4", uniqueSuffix),
    );
    const fileUri = this.adapter.getDestinationPath(fileName);

    console.log(
      `[DL] Manager add: id=${task.id} url=${task.url?.slice(0, 80)} title=${task.title} status=${task.status}`,
    );

    await DownloadDatabase.insert({
      ...task,
      fileUri,
    });
    this.queue.push(task.id);
    console.log(
      `[DL] Manager add: enqueued — queue=${this.queue.length} active=${this.activeInstances.size}`,
    );
    this.notifyQueue();
    this.processQueue();
    return task.id;
  }

  // ─── PAUSE (Bug E fix: stat file when liveReceived=0) ──────
  async pause(taskId: string): Promise<void> {
    console.log(
      `[DL] Manager pause: taskId=${taskId} active=${this.activeInstances.has(taskId)} liveReceived=${this.liveReceived.get(taskId)}`,
    );
    const instance = this.activeInstances.get(taskId);

    // AWAIT native pause FIRST, then read final live counters
    if (instance) {
      await instance.pause();
      // DON'T delete from activeInstances yet — keep handle for resume
    }

    let received = this.liveReceived.get(taskId) ?? 0;

    // Bug E fix: if live counter is 0, stat the actual file on disk
    if (received <= 0) {
      const task = await DownloadDatabase.getById(taskId);
      if (task) {
        // Check the stored fileUri first
        if (task.fileUri) {
          const info = await getInfoAsync(task.fileUri);
          if (info.exists && info.size > 0) {
            received = info.size;
            console.log(
              `[DL] Manager pause: recovered ${received} bytes from fileUri for ${taskId}`,
            );
          }
        }

        // If still 0, check the native download dir (Android external path)
        if (received <= 0) {
          const nativeUniqueSuffix =
            task.season != null && task.episode != null
              ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
              : task.id.slice(0, 20);
          const nativeName = sanitizeForNative(
            buildFileName(task.fileName, task.extension, nativeUniqueSuffix),
          );
          const nativePath = `${getNativeDownloadDir()}${nativeName}`;
          const nativeInfo = await getInfoAsync(nativePath);
          if (nativeInfo.exists && nativeInfo.size > 0) {
            received = nativeInfo.size;
            console.log(
              `[DL] Manager pause: recovered ${received} bytes from native path for ${taskId}`,
            );
          }
        }
      }
    }

    const total = this.liveTotal.get(taskId) ?? 0;
    const pausedTask = await DownloadDatabase.getById(taskId);
    await DownloadDatabase.update({
      id: taskId,
      status: "paused",
      receivedBytes: received,
      totalBytes: total > 0 ? total : undefined,
      resumeData: received > 0 ? String(received) : null,
      updatedAt: Date.now(),
    });

    // ── FIX 4: Include fileUri in pause emitStatus ──
    this.emitStatus({
      taskId,
      status: "paused",
      fileUri: pausedTask?.fileUri ?? null,
      receivedBytes: received,
      totalBytes: total > 0 ? total : undefined,
    });
    this.notifyQueue();
    console.log(
      `[DL] Manager pause done: taskId=${taskId} receivedBytes=${received}`,
    );
  }

  async resume(taskId: string): Promise<void> {
    const task = await DownloadDatabase.getById(taskId);
    console.log(
      `[DL] Manager resume: taskId=${taskId} found=${!!task} status=${task?.status} receivedBytes=${task?.receivedBytes} totalBytes=${task?.totalBytes}`,
    );
    if (!task) return;
    if (!["paused", "failed"].includes(task.status)) return;

    if (!this.networkPolicy.canDownload()) {
      console.log(
        `[DL] Manager resume: network unavailable — setting to pending`,
      );
      await DownloadDatabase.update({
        id: taskId,
        status: "pending",
        updatedAt: Date.now(),
      });
      this.queue.push(taskId);
      this.notifyQueue();
      return;
    }

    // Bug B fix: use buildFileName
    // Bug 3 fix: pass uniqueSuffix to prevent file name collisions
    const uniqueSuffix =
      task.season != null && task.episode != null
        ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
        : task.id.slice(0, 20);
    const fileName = sanitizeForNative(
      buildFileName(task.fileName, task.extension, uniqueSuffix),
    );
    const offsetBytes = task.receivedBytes || 0;
    const totalBytes = task.totalBytes || 0;
    console.log(
      `[DL] Manager resume: calling adapter.resumeDownload offsetBytes=${offsetBytes} fileName=${fileName}`,
    );

    // ── Bug 1: Set the resume offset in the adapter BEFORE native resume ──
    this.adapter.setResumeOffset(taskId, offsetBytes);
    this.adapter.setLastKnownTotal(taskId, totalBytes);

    try {
      const tracker = new SpeedTracker();
      this.speedTrackers.set(taskId, tracker);
      this.liveReceived.set(taskId, offsetBytes);
      this.liveTotal.set(taskId, totalBytes);

      let lastDbWrite = 0;
      let lastEmit = 0;

      await this.adapter.resumeDownload(
        taskId,
        task.url,
        fileName,
        offsetBytes,
        {
          onProgress: (received, total) => {
            if (!this.activeInstances.has(taskId)) return;
            this.liveReceived.set(taskId, received);
            if (total > 0) this.liveTotal.set(taskId, total);
            tracker.update(received);

            const now = Date.now();
            if (now - lastEmit >= PROGRESS_EMIT_INTERVAL) {
              lastEmit = now;
              this.emitProgress({
                taskId,
                receivedBytes: received,
                totalBytes:
                  total > 0 ? total : (this.liveTotal.get(taskId) ?? 0),
                speed: tracker.getSpeed(),
                eta: tracker.getEta(
                  Math.max(0, (this.liveTotal.get(taskId) ?? total) - received),
                ),
              });
            }
            if (now - lastDbWrite >= DB_WRITE_INTERVAL) {
              lastDbWrite = now;
              DownloadDatabase.update({
                id: taskId,
                receivedBytes: received,
                totalBytes: total > 0 ? total : undefined,
                updatedAt: now,
              }).catch(() => {});
            }
          },
          onDone: (filePath) => this.handleNativeDone(taskId, filePath),
          onError: (error) => this.handleNativeError(task, error),
        },
      );

      this.activeInstances.set(taskId, {
        id: taskId,
        pause: () => this.pause(taskId),
        resume: async () => {},
        cancel: () => this.adapter.cancelDownload(taskId),
      });
      console.log(
        `[DL] Manager resume: native adapter returned instance, setting status=downloading`,
      );
      await DownloadDatabase.update({
        id: taskId,
        status: "downloading",
        error: undefined,
        updatedAt: Date.now(),
      });
      const expectedFileUri = this.adapter.getDestinationPath(fileName);
      this.emitStatus({
        taskId,
        status: "downloading",
        fileUri: expectedFileUri,
        receivedBytes: this.liveReceived.get(taskId) ?? 0,
        totalBytes: this.liveTotal.get(taskId) ?? 0,
      });
    } catch (err) {
      console.warn(
        `[DL] Manager resume: native failed for ${taskId}, falling back to fresh download:`,
        err,
      );
      await DownloadDatabase.update({
        id: taskId,
        status: "pending",
        resumeData: null,
        receivedBytes: 0,
        error: undefined,
        updatedAt: Date.now(),
      });
      this.queue.push(taskId);
      this.notifyQueue();
      this.processQueue();
    }
  }

  // ─── CANCEL (Q6 fix: mark DB FIRST, then native cancel) ────
  async cancel(taskId: string): Promise<void> {
    console.log(
      `[DL] Manager cancel: taskId=${taskId} active=${this.activeInstances.has(taskId)}`,
    );

    const cancellingTask = await DownloadDatabase.getById(taskId);
    await DownloadDatabase.update({
      id: taskId,
      status: "cancelled",
      resumeData: null,
      receivedBytes: 0,
      updatedAt: Date.now(),
    });

    this.emitStatus({
      taskId,
      status: "cancelled",
      fileUri: cancellingTask?.fileUri ?? null,
      receivedBytes: this.liveReceived.get(taskId) ?? 0,
    });

    this.cleanup(taskId);

    const instance = this.activeInstances.get(taskId);
    if (instance) {
      await instance.cancel();
      this.activeInstances.delete(taskId);
    }

    this.adapter.markTaskDead(taskId);

    const task = await DownloadDatabase.getById(taskId);
    if (task) {
      if (task.fileUri) {
        deleteFile(task.fileUri);
      }
      const cancelUniqueSuffix =
        task.season != null && task.episode != null
          ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
          : task.id.slice(0, 20);
      const fileName = sanitizeForNative(
        buildFileName(task.fileName, task.extension, cancelUniqueSuffix),
      );
      const filePath = this.adapter.getDestinationPath(fileName);
      if (filePath !== task.fileUri) {
        deleteFile(filePath);
      }
    }

    this.notifyQueue();
    this.processQueue();
    console.log(`[DL] Manager cancel done: taskId=${taskId}`);
  }

  async retry(taskId: string): Promise<void> {
    /* ... */
  }
  async remove(taskId: string): Promise<void> {
    /* ... */
  }
  async pauseAll(): Promise<void> {
    /* ... */
  }
  async resumeAll(): Promise<void> {
    /* ... */
  }
  async cancelAll(): Promise<void> {
    /* ... */
  }

  getQueueLength(): number {
    return this.queue.length;
  }
  getActiveCount(): number {
    return this.activeInstances.size;
  }
  getNetworkPolicy(): NetworkAwarePolicy {
    return this.networkPolicy;
  }
  getStorageManager(): StorageManager {
    return this.storage;
  }
  isInitialized(): boolean {
    return this.initialized;
  }

  onProgress(fn: ProgressListener): () => void {
    /* ... */
  }
  onStatus(fn: StatusListener): () => void {
    /* ... */
  }
  onQueueChange(fn: QueueListener): () => void {
    /* ... */
  }

  private processQueue(): void {
    /* shared-promise pattern */
  }
  private async _drainQueue(): Promise<void> {
    /* ... */
  }

  private async startDownload(task: DownloadTask): Promise<void> {
    /* ... */
  }
  private async handleNativeDone(
    taskId: string,
    filePath: string,
  ): Promise<void> {
    /* ... */
  }
  private async completeTask(
    taskId: string,
    filePath: string,
    fileSize: number,
    totalBytes: number,
  ): Promise<void> {
    /* ... */
  }
  private async handleNativeError(
    task: DownloadTask,
    error: Error,
  ): Promise<void> {
    /* ... */
  }
  private async failTask(task: DownloadTask, err: unknown): Promise<void> {
    /* ... */
  }
  private cleanup(taskId: string): void {
    /* ... */
  }
  private emitProgress(p: DownloadProgress): void {
    /* ... */
  }
  private emitStatus(s: StatusChange): void {
    /* ... */
  }
  private notifyQueue(): void {
    /* ... */
  }
  async destroy(): Promise<void> {
    /* ... */
  }
}
```

### [`nativeAdapter.ts`](apps/mobile/lib/download/nativeAdapter.ts) — 370 lines

```typescript
import {
  NativeDownloadBridge,
  type CompleteEvent as NativeCompleteEvent,
} from "./nativeBridge";
import type { DownloadInstance } from "./adapter";
import { buildFileName, sanitizeForNative } from "./fileNameUtils";
import { getNativeDownloadDir, ensureDirectory, deleteFile } from "./fsCompat";

interface ProgressEvent {
  taskId: string;
  bytesDownloaded: number;
  bytesTotal: number;
}

interface PerTaskCallbacks {
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  onDone?: (filePath: string) => void;
  onError?: (error: Error) => void;
}

export class NativeDownloaderAdapter {
  private subscriptions: Array<{ remove: () => void }> = [];
  private globalListenersAttached = false;
  private activeCallbacks = new Map<string, PerTaskCallbacks>();
  private resumeOffsets = new Map<string, number>();
  private lastKnownTotals = new Map<string, number>();
  private lastProgressTime = new Map<string, number>();
  private lastProgressBytes = new Map<string, number>();
  private deadTasks = new Set<string>();

  private static readonly THROTTLE_MS = 300;
  private static readonly THROTTLE_BYTES = 1_000_000;

  constructor() {
    this.attachGlobalListeners();
  }

  private attachGlobalListeners(): void {
    if (this.globalListenersAttached) return;
    this.globalListenersAttached = true;
    this.subscriptions.push(
      NativeDownloadBridge.onProgress((e: ProgressEvent) =>
        this.handleProgress(e),
      ),
    );
    this.subscriptions.push(
      NativeDownloadBridge.onComplete((e: NativeCompleteEvent) =>
        this.handleComplete(e),
      ),
    );
    this.subscriptions.push(
      NativeDownloadBridge.onError((e) => {
        this.deadTasks.add(e.taskId);
        const cb = this.activeCallbacks.get(e.taskId);
        if (cb?.onError) cb.onError(new Error(e.error));
        this.activeCallbacks.delete(e.taskId);
      }),
    );
    this.subscriptions.push(
      NativeDownloadBridge.onPaused((e) => {
        /* no action needed */
      }),
    );
  }

  destroy(): void {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    this.globalListenersAttached = false;
    this.activeCallbacks.clear();
    this.resumeOffsets.clear();
    this.lastKnownTotals.clear();
    this.lastProgressTime.clear();
    this.lastProgressBytes.clear();
    this.deadTasks.clear();
  }

  setResumeOffset(taskId: string, offsetBytes: number): void {
    /* ... */
  }
  clearResumeOffset(taskId: string): void {
    /* ... */
  }
  setLastKnownTotal(taskId: string, totalBytes: number): void {
    /* ... */
  }
  markTaskDead(taskId: string): void {
    /* ... */
  }

  private handleProgress(e: ProgressEvent): void {
    // Throttled, offset-adjusted progress forwarding
    if (this.deadTasks.has(e.taskId)) return;
    const offset = this.resumeOffsets.get(e.taskId) ?? 0;
    const absoluteDownloaded = offset + e.bytesDownloaded;
    // ... total resolution, dedup, throttle ...
    this.activeCallbacks
      .get(e.taskId)
      ?.onProgress?.(absoluteDownloaded, absoluteTotal);
  }

  private handleComplete(e: NativeCompleteEvent): void {
    /* ... */
  }

  getDestinationPath(fileName: string): string {
    /* ... */
  }

  async download(options: { /* ... */ }): Promise<DownloadInstance> {
    /* ... */
  }

  async resumeDownload(
    taskId,
    url,
    fileName,
    offsetBytes,
    options,
  ): Promise<DownloadInstance> {
    /* ... */
  }

  hasActiveTask(taskId: string): boolean {
    /* ... */
  }
  supportsBackground(): boolean {
    return true;
  }
  async getAvailableStorage(): Promise<number> {
    /* ... */
  }

  private createInstance(id: string, fileName: string): DownloadInstance {
    return {
      id,
      pause: async () => {
        this.activeCallbacks.delete(id);
        await NativeDownloadBridge.pause(id);
      },
      resume: async () => {},
      cancel: async () => {
        this.markTaskDead(id);
        await NativeDownloadBridge.cancel(id).catch(() => {});
        const path = `${getNativeDownloadDir()}${this.sanitize(fileName)}`;
        deleteFile(path);
      },
    };
  }

  private sanitize(name: string): string {
    /* ... */
  }
}
```

### [`nativeBridge.ts`](apps/mobile/lib/download/nativeBridge.ts) — 129 lines

```typescript
import { NativeModules, NativeEventEmitter, Platform } from "react-native";

const { FilmsnapsDownloader } = NativeModules;
if (!FilmsnapsDownloader) {
  throw new Error("[FilmsnapsDownloader] Native module not found.");
}

const emitter = new NativeEventEmitter(FilmsnapsDownloader);

export interface ProgressEvent {
  taskId: string;
  bytesDownloaded: number;
  bytesTotal: number;
}

export interface CompleteEvent {
  taskId: string;
  filePath: string;
  bytesTotal: number;
}

export interface ErrorEvent {
  taskId: string;
  error: string;
  errorCode?: number;
}

export interface PausedEvent {
  taskId: string;
  bytesDownloaded: number;
  bytesTotal: number;
}

export const NativeDownloadBridge = {
  start(
    taskId: string,
    url: string,
    fileName: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    return FilmsnapsDownloader.startDownload(
      taskId,
      url,
      fileName,
      headers ?? {},
    );
  },
  pause(taskId: string): Promise<void> {
    return FilmsnapsDownloader.pauseDownload(taskId);
  },
  resume(
    taskId: string,
    url: string,
    fileName: string,
    offsetBytes: number,
    headers?: Record<string, string>,
  ): Promise<string> {
    return FilmsnapsDownloader.resumeDownload(
      taskId,
      url,
      fileName,
      offsetBytes,
      headers ?? {},
    );
  },
  cancel(taskId: string): Promise<void> {
    return FilmsnapsDownloader.cancelDownload(taskId);
  },
  getAvailableStorage(): Promise<number> {
    return FilmsnapsDownloader.getAvailableStorage();
  },
  async resumeDownload(params: {
    taskId: string;
    url: string;
    fileName: string;
    offsetBytes: number;
    totalBytes: number;
  }): Promise<void> {
    const headers: Record<string, string> = {
      __totalBytes: String(params.totalBytes),
    };
    await FilmsnapsDownloader.resumeDownload(
      params.taskId,
      params.url,
      params.fileName,
      params.offsetBytes,
      headers,
    );
  },
  onProgress(callback: (e: ProgressEvent) => void): () => void {
    /* ... */
  },
  onComplete(callback: (e: CompleteEvent) => void): () => void {
    /* ... */
  },
  onError(callback: (e: ErrorEvent) => void): () => void {
    /* ... */
  },
  onPaused(callback: (e: PausedEvent) => void): () => void {
    /* ... */
  },
  removeAllListeners(): void {
    /* ... */
  },
};
```

### [`FilmsnapsDownloadModule.kt`](apps/mobile/android/app/src/main/java/app/filmsnaps/mobile/download/FilmsnapsDownloadModule.kt) — 502 lines

Full Kotlin module. Uses Android `DownloadManager` with:

- `startDownload()`: Enqueues a `DownloadManager.Request` + starts 500ms polling loop via Handler+Runnable cursor query
- `pauseDownload()`: Stops polling, reads bytes from cursor, calls `downloadManager.remove(nativeId)`, saves offset
- `resumeDownload()`: Deletes existing partial file (!), creates new DownloadManager request with Range header, starts new polling
- `cancelDownload()`: Stops polling, removes from DownloadManager, cleans up maps
- `startProgressPolling()`: 500ms Runnable that queries DownloadManager cursor for STATUS, BYTES_DOWNLOADED_SO_FAR, TOTAL_SIZE_BYTES
- `completionReceiver()`: BroadcastReceiver for ACTION_DOWNLOAD_COMPLETE, queries cursor for localUri
- Event emission via `DeviceEventManagerModule.RCTDeviceEventEmitter`
- Maps: `taskToNativeId`, `nativeToTaskId`, `taskResumeOffsets`, `taskOriginalTotalBytes`

**CRITICAL BUG IN KOTLIN**: `pauseDownload()` at line 232 calls `downloadManager.remove(nativeId)` which DESTROYS the Android download task. The task never actually pauses — it's cancelled. `resumeDownload()` then deletes the partial file and starts a fresh download with a `Range` header that **Android DownloadManager silently ignores** because it doesn't support resumable downloads.

### [`store.ts`](apps/mobile/lib/download/store.ts) — 147 lines

Synchronous in-memory store with subscription pattern:

- `tasks: DownloadTask[]` — in-memory array
- `upsert(task)`: Find or replace in array synchronously, notify listeners, fire-and-forget DB insert for new tasks
- For existing task updates: only updates in-memory (manager handles DB writes)
- `subscribe(fn)`, `subscribeTask(id, fn)`: Return `Unsubscribe` function
- `load()`: Hydrate from SQLite, mark loaded, notify

### [`database.ts`](apps/mobile/lib/download/database.ts) — 360 lines

SQLite via `expo-sqlite`:

- `openDatabaseAsync("filmsnaps_downloads.db")`
- Schema: `downloads` table with 27 columns (id, media_id, media_type, title, url, file_path, file_size, downloaded_bytes, status, priority, resume_data, etc.)
- Migration system for new columns (native_task_id, expected_hash, started_on_wifi)
- `rowToTask()`: Maps DB row to `DownloadTask` type with proper coercion
- `insert()`, `update()`, `getById()`, `getAll()`, `getByStatus()`, `getByMediaId()`, `getBySeason()`, `delete()`, `deleteCompleted()`, `deleteCancelled()`, `getCountByStatus()`, `getStorageUsed()`, `recoverStaleTasks()` (marks downloading/retrying→paused), `close()`

### [`context.tsx`](apps/mobile/lib/download/context.tsx) — 257 lines

React Context provider:

- Creates singleton `DownloadManager` and store refs
- `useEffect` loads store from DB → initializes manager → sets `loaded=true`
- Wires manager events → store mutations (progress → upsert, status → upsert)
- `enqueue(meta)`: Creates task record, inserts to store, calls `manager.add()`
- `control(action, target)`: Batch control via ID or status filter

### Supporting Files

**`types.ts`** — All shared types (already shown in full above).

**`fsCompat.ts`** — SDK 55 modern API wrappers:

- `getInfoAsync(uri)`: Uses `new File(uri)` modern API, never throws
- `getNativeDownloadDir()`: Returns platform-specific directory matching Kotlin's `setDestinationInExternalFilesDir`
- `fileExistsSync()`, `fileSizeSync()`, `ensureDirectory()`, `deleteFile()`, `moveFile()`, `listDirectory()`

**`fileNameUtils.ts`** — Extension-safe name builder:

- `buildFileName(fileName, extension, uniqueSuffix)`: Strips existing extension, appends canonical one + optional suffix
- `sanitizeForNative(fileName)`: Removes chars illegal in native paths (matches Kotlin's `safeName` sanitization)

**`storageManager.ts`** — Disk space management (131 lines)

**`networkPolicy.ts`** — NetInfo-based connectivity (81 lines)

**`notifications.ts`** — expo-notifications wrapper (93 lines)

**`utils.ts`** — Shared utilities: `toSafeNumber()`, `sanitizeResumeData()`, `formatBytes()`

**`migration.ts`** — One-time migration from legacy system (105 lines)

---

## REQUIREMENTS

1. **Replace the entire native-layer implementation** (FilmsnapsDownloadModule.kt). The current Android DownloadManager approach is fundamentally broken for pause/resume. Consider:
   - OkHttp + custom ForegroundService
   - Thread-safe pause/resume with proper locks
   - Real InputStream-based byte counting (not cursor polling)
   - True HTTP Range-request resume
   - Keep the same JS interface (`NativeDownloadBridge` signatures) so the JS layer doesn't need massive changes

2. **Fix the pause infinite-loop bug** at the architectural level — not with band-aids. The createInstance().pause() deleting callbacks before native pause completes is a design flaw. The adapter should NOT handle pause at all — the manager orchestrates everything.

3. **Ensure ALL 18 required features** are supported

4. **Provide complete, drop-in replacement code** for the Kotlin native module

5. **Minimize JS-side changes** — the `NativeDownloadBridge` API (start, pause, resume, cancel, onProgress, onComplete, onError, onPaused) should remain stable

6. **Priority: reliability over features**. A system that downloads, pauses, and resumes 100% of the time is better than one with 10 features that all fail intermittently.

---

## PACKAGE.JSON (apps/mobile)

```json
{
  "name": "@filmsnaps/mobile",
  "version": "0.1.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "expo": "~55.0.27",
    "react": "19.2.0",
    "react-native": "0.83.6",
    "expo-file-system": "~55.0.23",
    "expo-sqlite": "~55.0.0",
    "expo-notifications": "~55.0.25",
    "expo-router": "~55.0.16",
    "expo-constants": "~55.0.16",
    "expo-task-manager": "~55.0.0",
    "expo-background-fetch": "~55.0.0",
    "react-native-safe-area-context": "~5.6.2",
    "@react-native-community/netinfo": "^11.4.1",
    "@react-native-async-storage/async-storage": "^2.2.0",
    "expo-haptics": "^55.0.0",
    "expo-image": "~55.0.11",
    "expo-sharing": "~55.0.21",
    "expo-video": "~55.0.18",
    "react-native-gesture-handler": "^3.1.0",
    "react-native-reanimated": "4.2.1",
    "react-native-svg": "^15.15.3",
    "react-native-webview": "13.16.0",
    "react-native-web": "^0.21.0",
    "react-native-css-interop": "^0.2.5",
    "nativewind": "^4.0.0",
    "tailwindcss": "^3.4.17"
  },
  "devDependencies": {
    "@types/react": "~19.2.10",
    "typescript": "^5"
  }
}
```

---

## WHAT WE NEED FROM YOU

1. **Complete new `FilmsnapsDownloadModule.kt`** — Replace Android DownloadManager with OkHttp-based ForegroundService with true pause/resume support

2. **Updated `FilmsnapsDownloadModule.kt` (plugin copy)** — Same as above, but for the prebuild plugin template at `plugins/with-filmsnaps-downloader/files/FilmsnapsDownloadModule.kt`

3. **If needed, minor JS-side adapter changes** to `nativeAdapter.ts` and `nativeBridge.ts`

4. **Explanation of the architecture** — how your new native module solves each of the 18 requirements

5. **Any new plugin code needed** (manifest permissions, foreground service registration, etc.)

6. **Thread-safety analysis** — how you prevent the pause → stack overflow pattern in the new design
