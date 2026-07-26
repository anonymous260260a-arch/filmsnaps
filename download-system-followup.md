# Download System Follow-up — Pause/Resume, Background, Progress Glitches

---

## 1. Status Update

The previous 1-byte file issue is **resolved**. Downloads now succeed. Three new issues have surfaced:

1. **Pause → Resume starts from 0** (not resuming from the byte offset)
2. **Background download not working** (background task doesn't resume paused downloads)
3. **Progress bar glitches** — receivedBytes fluctuates (e.g. 11 MB → 9.2 MB → 12 MB)

---

## 2. Environment

| Field                       | Value                                         |
| --------------------------- | --------------------------------------------- |
| **App**                     | Filmsnaps mobile (React Native / Expo)        |
| **RN Version**              | 0.83.6                                        |
| **Expo SDK**                | 55                                            |
| **Native Download Library** | `react-native-blob-util` v0.17.3              |
| **Persistence**             | `expo-sqlite` (SQLite)                        |
| **Notifications**           | `expo-notifications`                          |
| **Background Tasks**        | `expo-task-manager` + `expo-background-fetch` |
| **Platform Tested**         | Android                                       |

---

## 3. What Was Fixed Since Last Report

The following fixes from the previous expert consultation were applied:

1. **Removed `addAndroidDownloads` block** from all RNFB configs — this blocked the OS from creating a 1-byte placeholder stub at the target path
2. **Removed `Promise.race` + `fetchWithTimeout` pattern** — `Promise.race` destroys RNFB's `StatefulPromise` which carries `.progress()`, `.then()` and `.catch()`. Replaced with `setTimeout` + `fetchTask.cancel()`
3. **Captures `StatefulPromise` directly** — wires `.progress()`, `.then()` and `.catch()` on the StatefulPromise _before_ it can resolve, ensuring callbacks fire correctly
4. **Added HTTP status code validation** — rejects responses where `res.respInfo.status >= 400`
5. **Added path-mismatch handling** — when `res.path()` differs from the configured `options.filePath` (RNFB sometimes writes to cache/temp), copies via `fs.cp()`

---

## 4. Live Logs

Captured during a fresh download test on Android (physical device):

```
 LOG  [Enqueue] Download URL: https://download-falix-falixmovies-backend-hf.hf.space/dl/.../Silo%20S03E01%20480p%20English%20WEB-DL%20ESub%20x264-Falix.mkv
 LOG  [Enqueue] File: Silo-480p.mkv, Server: falix, Speed limit: 0 B/s
 LOG  [Manager] Starting download: https://download-falix-.../Silo%20S03E01%20480p%20English%20WEB-DL%20ESub%20x264-Falix.mkv
 LOG  [Manager] File: Silo-480p.mkv, Resume: false, Path: /storage/emulated/0/Android/data/app.filmsnaps.mobile/files/Download/Filmsnaps/Silo-480p.mkv, Speed limit: 0
 LOG  [BlobDownloader] Full-speed download: https://download-falix-.../...x264-Falix.mkv
 LOG  [Manager] Starting download: https://download-falix-.../...x264-Falix.mkv
 LOG  [Manager] File: Silo-480p.mkv, Resume: false, Path: /storage/emulated/0/Android/data/app.filmsnaps.mobile/files/Download/Filmsnaps/Silo-480p.mkv, Speed limit: 0
 LOG  [BlobDownloader] Full-speed download: https://download-falix-.../...x264-Falix.mkv
```

### Key observations

1. **The download is enqueued twice** — `[Manager] Starting download` and `[BlobDownloader] Full-speed download` each appear twice for the same URL. This suggests `processQueue()` is calling `startDownload` twice, possibly because the first call's `setImmediate` has not yet added the task to `activeInstances` before a second queue check fires.

2. **No `[BlobDownloader] HTTP Status` log line** — The expert-fix diagnostic log I added (`console.log(\`[BlobDownloader] HTTP Status: ${status}, res.path(): ${res.path()}, expected: ${options.filePath}\`)`) does not appear. This means either:
   - The `.then()` handler on the StatefulPromise has not yet fired (still downloading)
   - Or the fetch is resolving to an error caught by the `.catch()` path, which would log `[BlobDownloader] Download failed: [error]`

3. **The file path uses the app-specific directory** (`Android/data/app.filmsnaps.mobile/files/Download/Filmsnaps/`) rather than the public `/storage/emulated/0/Download/Filmsnaps/`. This is expected for Android 11+ scoped storage (`DownloadDir` resolves to the app's external files directory on modern Android).

---

## 5. Issue 1: Pause → Resume Starts from 0

### Current Behavior

When the user taps "Pause" on an active download, then "Resume", the download starts over from 0 bytes instead of continuing from where it left off.

### Current Code for Pause

In [blobDownloader.ts:createInstance](apps/mobile/lib/download/blobDownloader.ts):

```typescript
pause: async () => {
  state.paused = true;
  if (state.fetchTask) {
    try { await cancelFetch(state.fetchTask); } catch {}
    state.fetchTask = null;
  }
},
```

`cancelFetch` calls `fetchTask.cancel()` on the RNFB StatefulPromise, which cancels the native HTTP request. The `state.paused` flag is set, which prevents the `.then()` and `.catch()` handlers from firing onDone/onError. **But no `resumeData` is persisted anywhere in the adapter.** The manager doesn't know the byte offset to resume from.

### Current Code for Resume in Adapter

```typescript
resume: async () => {
  state.paused = false;
  state.cancelled = false;

  // If the state has a receivedBytes offset and totalSize, restart chunked from offset
  if (state.chunkedMode && state.currentOffset > 0 && state.totalBytes > 0) {
    const speedLimit = options.speedLimit ?? 0;
    if (speedLimit > 0 && state.currentOffset < state.totalBytes) {
      this.runChunkedLoop(
        downloadId,
        state,
        state.totalBytes,
        state.currentOffset,
        speedLimit,
        options,
      ).catch((err) => {
        activeDownloads.delete(downloadId);
        options.onError?.(err);
      });
    }
  }
},
```

For non-chunked (full-speed) downloads, `resume()` does nothing — it just sets `state.paused = false`, but the fetch has already been cancelled. The manager must re-issue the download with a `Range` header, but that's the manager's job in `startDownload`.

### Current Manager Flow for Pause

In [manager.ts:223](apps/mobile/lib/download/manager.ts):

```typescript
async pause(taskId: string): Promise<void> {
  const instance = this.activeInstances.get(taskId);
  if (instance) {
    try { await instance.pause(); } catch {}
    this.activeInstances.delete(taskId);
    this.activeTasks.delete(taskId);
    this.activeSpeedTrackers.delete(taskId);
  }

  await DownloadDatabase.update({ id: taskId, status: 'paused' });
  this.emitStatus(taskId, 'paused');
  // ...
}
```

The `pause()` on the instance cancels the fetch. The manager updates status to `'paused'` in SQLite and emits the status. **But `resumeData` is never set** — `receivedBytes` in the DB was being updated via `onProgress`, but if the progress glitch causes it to go up/down, the wrong offset is stored.

### Current Manager Flow for Resume

In [manager.ts:243](apps/mobile/lib/download/manager.ts):

```typescript
async resume(taskId: string): Promise<void> {
  const task = await DownloadDatabase.getById(taskId);
  if (!task) return;

  await DownloadDatabase.update({ id: taskId, status: 'pending', error: undefined });

  if (!this.queue.includes(taskId)) {
    this.queue.push(taskId);
  }
  this.notifyQueue();
  this.processQueue();
}
```

This reads the task from DB, sets it to `'pending'`, and re-queues it. When `processQueue` picks it up, `startDownload` runs again:

```typescript
if (task.resumeData) {
  const parsed = parseInt(task.resumeData, 10);
  if (!isNaN(parsed) && parsed > 0) {
    headers["Range"] = `bytes=${parsed}-`;
  }
}
```

**But `task.resumeData` was never set by the pause flow.** The DB update in `pause()` only sets `status: 'paused'`. So `resumeData` is `undefined`, no `Range` header is sent, and the download starts from 0.

### What We Think Needs to Happen

1. When `pause()` is called in the adapter, it should save `state.receivedBytes` somewhere the manager can access it
2. The manager's `pause()` should persist `receivedBytes` as `resumeData` in the SQLite DB
3. When `resume()` is called, the manager reads `resumeData` and sets the `Range` header

Currently the `onProgress` callback IS DB-persisting `receivedBytes`, but:

- The progress glitch (Issue 3) may be corrupting it
- Even if `receivedBytes` is correct in the DB, `startDownload` reads `task.resumeData`, not `task.receivedBytes`

---

## 6. Issue 2: Background Download Not Working

### Current Behavior

When the app is backgrounded, pending/paused downloads are not resumed. The background task is registered but does not download files.

### Current Registration

In [backgroundTask.ts:327](apps/mobile/lib/download/backgroundTask.ts):

```typescript
export async function registerBackgroundDownloadTask(): Promise<boolean> {
  try {
    // ...
    await BackgroundFetch.registerTaskAsync(BACKGROUND_DOWNLOAD_TASK, {
      minimumInterval: 15 * 60, // 15 minutes (iOS minimum)
      stopOnTerminate: false,
      startOnBoot: true,
    });
    return true;
  } catch (err) {
    console.error("[BackgroundTask] Registration failed:", err);
    return false;
  }
}
```

### Current Implementation

The background task reads downloads from `AsyncStorage` at key `@filmsnaps/downloads/v2`:

```typescript
const raw = await AsyncStorage.getItem(STORAGE_KEY);
if (!raw) {
  console.log("[BackgroundTask] No downloads found");
  return BackgroundFetch.BackgroundFetchResult.NoData;
}

const tasks: BackgroundDownloadTask[] = JSON.parse(raw);
const pendingTasks = tasks.filter(
  (t) => t.status === "pending" || t.status === "paused",
);
```

**But the current download system uses SQLite** (via `DownloadDatabase`), not AsyncStorage. The background task is looking at the wrong storage layer. The `STORAGE_KEY` (`@filmsnaps/downloads/v2`) was used by the old system but the new system uses `expo-sqlite`.

### The Gap

As confirmed in the code, the `@filmsnaps/downloads/v2` AsyncStorage key is never written by the current download flow. The `STORE_KEY` constant in `store.ts` is `@filmsnaps/downloads/v2`, but `persistAll()` in the AsyncStorage adapter syncs from SQLite to AsyncStorage only if the `store` module is using its AsyncStorage fallback. There are **two storage layers** and they may be out of sync.

The background task needs to either:

- Read from SQLite directly (using the same `expo-sqlite` database + table)
- Or ensure a reliable sync pipeline from SQLite → AsyncStorage before the app backgrounds

---

## 7. Issue 3: Progress Bar Glitches

### Current Behavior

The progress bar shows non-monotonic values — e.g. 11 MB, then 9.2 MB, then 12 MB. This suggests that `receivedBytes` is being updated from a source that resets or fluctuates.

### Current Progress Flow

1. **RNFB StatefulPromise**.progress() fires → raw `(received, total)` values
2. **BlobDownloaderAdapter** gets raw values, calls `options.onProgress(received, total)`
3. **Manager's `startDownload`** receives them:
   ```typescript
   const adjustedReceived = isResume
     ? (parseInt(task.resumeData || "0", 10) || 0) + received
     : received;
   ```
4. Manager calls `emitProgress(task.id, adjustedReceived, adjustedTotal, speed, eta)`
5. Provider's event handler in `context.tsx` updates the store:
   ```typescript
   const existing = store.getById(p.taskId);
   if (existing) {
     store.upsert({
       ...existing,
       receivedBytes: p.receivedBytes,
       totalBytes: p.totalBytes,
       status: "downloading",
     });
   }
   ```
6. React hooks re-render from store subscription

### Potential Causes

1. **RNFB `received` value may reset between chunk boundaries in chunked mode** — The `progress()` callback on a `StatefulPromise` returns the received bytes for the _current fetch_. If the adapter is in chunked mode (speed-limited), each chunk creates a new `StatefulPromise` and the progress callback for each chunk starts from 0.

2. **DB race conditions in progress writes** — `DownloadDatabase.update()` is called on every progress tick without throttling:

   ```typescript
   DownloadDatabase.update({
     id: task.id,
     receivedBytes: adjustedReceived,
     totalBytes: adjustedTotal,
   }).catch((e) => { ... });
   ```

   If writes overlap, an older value could overwrite a newer one.

3. **Store → DB → Store race** — The progress flow is: RNFB callback → Manager emitProgress → Provider event handler upserts store → Store debounced write to DB. If a stale read from the store gets re-written, older progress values can surface.

---

## 8. Full Code Reference

### `blobDownloader.ts` — Pause/Resume methods (from `createInstance`)

```typescript
private createInstance(
  downloadId: string,
  state: ActiveDownload,
  options: DownloadOptions,
): DownloadInstance {
  return {
    id: downloadId,
    pause: async () => {
      state.paused = true;
      if (state.fetchTask) {
        try { await cancelFetch(state.fetchTask); } catch {}
        state.fetchTask = null;
      }
    },
    resume: async () => {
      state.paused = false;
      state.cancelled = false;

      if (state.chunkedMode && state.currentOffset > 0 && state.totalBytes > 0) {
        const speedLimit = options.speedLimit ?? 0;
        if (speedLimit > 0 && state.currentOffset < state.totalBytes) {
          this.runChunkedLoop(
            downloadId,
            state,
            state.totalBytes,
            state.currentOffset,
            speedLimit,
            options,
          ).catch((err) => {
            activeDownloads.delete(downloadId);
            options.onError?.(err);
          });
        }
      }
    },
    cancel: async () => {
      state.cancelled = true;
      if (state.fetchTask) {
        try { await cancelFetch(state.fetchTask); } catch {}
        state.fetchTask = null;
      }
      await this.cleanupChunks(state.chunkPaths);
      try {
        if (await RNFBlobUtil.fs.exists(state.filePath)) {
          await RNFBlobUtil.fs.unlink(state.filePath);
        }
      } catch {}
      for (const p of state.chunkPaths) {
        try {
          if (await RNFBlobUtil.fs.exists(p)) {
            await RNFBlobUtil.fs.unlink(p);
          }
        } catch {}
      }
      activeDownloads.delete(downloadId);
    },
  };
}
```

### `manager.ts` — pause

```typescript
async pause(taskId: string): Promise<void> {
  const instance = this.activeInstances.get(taskId);
  if (instance) {
    try { await instance.pause(); } catch {}
    this.activeInstances.delete(taskId);
    this.activeTasks.delete(taskId);
    this.activeSpeedTrackers.delete(taskId);
  }

  await DownloadDatabase.update({ id: taskId, status: 'paused' });
  this.emitStatus(taskId, 'paused');

  this.queue = this.queue.filter((id) => id !== taskId);
  this.notifyQueue();
  this.processQueue();
}
```

### `manager.ts` — resume

```typescript
async resume(taskId: string): Promise<void> {
  const task = await DownloadDatabase.getById(taskId);
  if (!task) return;

  await DownloadDatabase.update({ id: taskId, status: 'pending', error: undefined });

  if (!this.queue.includes(taskId)) {
    this.queue.push(taskId);
  }
  this.notifyQueue();
  this.processQueue();
}
```

### `manager.ts` — startDownload (resume handling portion)

```typescript
const headers: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};
if (task.resumeData) {
  const parsed = parseInt(task.resumeData, 10);
  if (!isNaN(parsed) && parsed > 0) {
    headers["Range"] = `bytes=${parsed}-`;
  }
}

const isResume = !!headers["Range"];
const actualPath = isResume ? `${filePath}.resume` : filePath;
```

### `onProgress` in startDownload callbacks

```typescript
onProgress: (received: number, total: number) => {
  const adjustedReceived = isResume ? (parseInt(task.resumeData || '0', 10) || 0) + received : received;
  const adjustedTotal = total > 0 ? (isResume ? (parseInt(task.resumeData || '0', 10) || 0) + total : total) : 0;

  const { speed, eta } = updateSpeed(speedTracker, adjustedReceived, adjustedTotal);

  DownloadDatabase.update({
    id: task.id,
    receivedBytes: adjustedReceived,
    totalBytes: adjustedTotal,
  }).catch((e) => { ... });

  this.emitProgress(task.id, adjustedReceived, adjustedTotal, speed, eta);
},
```

### `backgroundTask.ts` — the storage key discrepancy

```typescript
const STORAGE_KEY = "@filmsnaps/downloads/v2";

// Inside task handler:
const raw = await AsyncStorage.getItem(STORAGE_KEY);
// ...filter by status === 'pending' || status === 'paused'
```

### `store.ts` — the storage key

```typescript
const STORE_KEY = "@filmsnaps/downloads/v2";
```

The `store.ts` writes to `AsyncStorage` at `@filmsnaps/downloads/v2` but **only when using the `AsyncStorageAdapter`** (the fallback). When using SQLite (the default), the background task's AsyncStorage read returns empty.

---

## 9. Questions for the Expert

### Issue 1: Pause/Resume Starts from 0

1. **Where should `resumeData` be persisted when pause is called?** Should the adapter's `pause()` method save `state.receivedBytes` and return it, and the manager persist it to SQLite? Or should the manager track `receivedBytes` independently via the `onProgress` callback and persist it during pause?

2. **What exact code change is needed to persist `resumeData` during pause?** Provide the implementation for `manager.pause()` to save `receivedBytes` as `resumeData`.

3. **For full-speed (non-chunked) downloads, how should resume work architecturally?** After `fetchTask.cancel()`, the adapter's state is cleared. The manager must re-issue the download with a `Range` header. Is the current `startDownload → adapter.download` flow correct for this, or does the adapter need a separate mechanism?

4. **Should the `resume()` method on the adapter's `DownloadInstance` do anything at all for full-speed downloads?** Currently it's a no-op for non-chunked mode. Should we remove it and let the manager handle everything via re-queuing?

5. **What is the exact correct `Range` header format for RNFB?** Is `bytes={offset}-` the correct format, or does RNFB need a different format?

### Issue 2: Background Download Not Working

6. **How should the background task access download data?** Should it read from `expo-sqlite` directly (same DB as the main app), or should there be a separate sync from SQLite → AsyncStorage before backgrounding?

7. **What is the minimal, proven pattern for reading from `expo-sqlite` in a background task?** The background task is a separate JS context — does `expo-sqlite` work there? Provide exact code.

8. **Should the background task use `BlobDownloaderAdapter` or directly use RNFB fetch?** Currently it uses RNFB directly with `config().fetch()`. But the adapter now has all the fixes (path mismatch, HTTP status, no Promise.race). Should the background task delegate to `BlobDownloaderAdapter.download()` instead?

9. **What `expo-background-fetch` configuration is proven to work on Android for this use case?** Provide the exact configuration values for `minimumInterval`, `stopOnTerminate`, `startOnBoot`.

### Issue 3: Progress Bar Glitches

10. **Is RNFB's `.progress()` callback guaranteed to return monotonically increasing `received` values?** If not, what causes the reset — is it per-fetch-instance (new fetch for each chunk in chunked mode), or something else?

11. **Should `onProgress` in the manager throttle DB writes?** Currently every progress tick triggers a DB write. Provide the throttling pattern.

12. **Is the progress glitch caused by the `isResume ? parseInt(task.resumeData || '0', 10) + received : received` calculation?** The `task.resumeData` reference is captured at closure creation time — if it changes during download (e.g., from an overlapping DB update), the wrong offset could be added. Should this read from a ref/state variable instead?

13. **Provide optimized, glitch-free progress tracking code** — monotonic, throttled, correctly handling both the full-speed and chunked (speed-limited) modes.

---

_Generated for Filmsnaps download system expert consultation. Three new issues post-fix._
