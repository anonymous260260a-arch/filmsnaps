# Filmsnaps Download System — Post-Implementation Expert Follow-up

**Document Type:** Explanation / Troubleshooting hybrid\
**Audience:** The expert who prescribed the `@kesha-antonov/react-native-background-downloader` architecture\
**Status:** All phases implemented, builds succeed, but downloads don't actually work at runtime

---

## 1. Executive Summary

The complete download system was rebuilt per your architecture specification:

- **Phases 1–3** (New modules + core): `nativeAdapter.ts`, `networkPolicy.ts`, `storageManager.ts`, `migration.ts`, rewritten `manager.ts`, `context.tsx`, `database.ts`, `types.ts`, `store.ts`, `notifications.ts`, `index.ts`
- **Phase 4** (Hooks): `useDownloadList.ts`, `useDownload.ts`, `useDownloadQueue.ts`, `useEpisodeDownloads.ts` — all updated and exporting the correct return types
- **Phase 5** (Cleanup): `engine.ts`, `blobDownloader.ts`, `backgroundTask.ts` deleted
- **Phase 6** (Consumers): `_layout.tsx`, `DownloadSheet.tsx`, `DownloadBanner.tsx`, `DownloadToast.tsx`, `downloads.tsx` — all updated to import from `@/lib/download`
- **Phase 7** (Package): `package.json` cleaned, `app.json` cleaned (old plugins/permissions removed)
- **Phase 8** (TypeScript): Compiles cleanly (`npx tsc --noEmit` passes)

**The Problem:** Despite clean compilation, runtime downloads fail. The key symptoms:

1. **Events don't bridge** — `NativeEventEmitter` throws `addListener` / `removeListeners` not found warnings, meaning begin/progress/done/error callbacks never fire from the native side
2. **UI shows 0B** — without events, the UI never updates progress; only after pressing "resume" does the correct file size appear but download still doesn't start
3. **recoverStaleTasks() races with fresh adds** — marking "pending" tasks as "paused" when they were just enqueued in the current session
4. **Resume creates a brand new OS download** instead of resuming the existing OS task
5. **processQueue re-entrancy** — the same task can start 3× without the activeInstances guard

---

## 2. Architecture (As-Built)

```
┌─────────────────────────────────────────────────────────┐
│                      UI Components                       │
│  DownloadSheet, DownloadBanner, DownloadToast,           │
│  downloads.tsx, SeasonPicker (batch download)            │
└──────────────┬──────────────────────────────────────────┘
               │ hooks
┌──────────────▼──────────────────────────────────────────┐
│                     Hooks Layer                          │
│  useDownloadList()    → grouped by status               │
│  useDownload(id)      → single task + actions            │
│  useDownloadQueue()   → queue state + batch actions      │
│  useEpisodeDownloads()→ season-level aggregate           │
└──────────────┬──────────────────────────────────────────┘
               │ context
┌──────────────▼──────────────────────────────────────────┐
│              DownloadInfraProvider (context.tsx)          │
│  Creates: DownloadManager (singleton)                    │
│           DownloadStore (IDownloadStore, memory+SQLite) │
│  Exposes: enqueue(), control(), manager, store           │
└──────────────┬──────────────────────────────────────────┘
               │
        ┌──────┴──────┐
┌───────▼───────┐ ┌───▼────────────┐
│  DownloadStore │ │ DownloadManager│
│  (store.ts)    │ │ (manager.ts)   │
│  In-memory +   │ │ Queue logic    │
│  SQLite backup │ │ Retry backoff  │
│                │ │ Network policy │
│                │ │ Pause/resume   │
└───────┬───────┘ │ Storage checks │
        │         └───┬────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
   ┌──────▼──┐ ┌──────▼──┐ ┌─────▼─────┐
   │Native   │ │Network  │ │Storage    │
   │Download │ │Aware    │ │Manager    │
   │Adapter  │ │Policy   │ │           │
   │(OS)     │ │(NetInfo)│ │(FS reads) │
   └─────────┘ └─────────┘ └───────────┘
```

### Key Files

| File               | Lines | Role                                                      |
| ------------------ | ----- | --------------------------------------------------------- |
| `nativeAdapter.ts` | 266   | Wraps `@kesha-antonov/react-native-background-downloader` |
| `manager.ts`       | 649   | Orchestrator: queue, retry, network, storage              |
| `context.tsx`      | 210   | React provider, wires manager→store events                |
| `store.ts`         | 139   | In-memory array + SQLite persistence                      |
| `database.ts`      | 335   | SQLite CRUD + schema + migration                          |
| `types.ts`         | 144   | All shared types                                          |
| `adapter.ts`       | 49    | Interface: `IDownloaderAdapter`                           |

---

## 3. What the Expert Already Prescribed (Fixes Applied)

From the expert's first consultation (`Download_System_Implementation.md`), we applied:

1. **Use `@kesha-antonov/react-native-background-downloader`** instead of `react-native-blob-util` + foreground service — OS-managed, survives app death, typed native values
2. **Create `NetworkAwarePolicy`** — WiFi/cellular awareness via `@react-native-community/netinfo`
3. **Create `StorageManager`** — space pre-checks + LRU eviction
4. **Rewrite `manager.ts`** — simplified queue with `NativeDownloaderAdapter`, `SpeedTracker` class
5. **Polling fallback** — 1-second interval reading `nativeTask.bytesDownloaded`/`bytesTotal`/`state` directly (workaround for broken event bridge)
6. **Eager `NetInfo.fetch()`** in constructor so `canDownload()` works immediately
7. **`activeInstances.has(taskId)` guard** in processQueue to prevent duplicate starts
8. **Cached getSnapshot in `useDownloadQueue.ts`** to prevent infinite loop from `useSyncExternalStore`

---

## 4. Remaining Issues (Need Expert Help)

### 4A. NativeEventEmitter — Events Never Bridge

**Symptom:**

```
WARN  `new NativeEventEmitter()` was called with a non-null argument
without the required `addListener` method.
WARN  `new NativeEventEmitter()` was called with a non-null argument
without the required `removeListeners` method.
```

**Root cause:** The `@kesha-antonov/react-native-background-downloader` native module (`RNBackgroundDownloaderModule`) doesn't conform to the `NativeEventEmitter` protocol that React Native 0.83 expects. The native module apparently uses a newer or non-standard event bridging pattern — or simply doesn't implement `addListener`/`removeListeners` as required by `DeviceEventEmitter`.

**Current workaround:** We added a 1-second polling fallback in `nativeAdapter.ts::download()` (lines 128–149) that reads `nativeTask.bytesDownloaded`, `nativeTask.bytesTotal`, and `nativeTask.state` directly. However, on recovered/reattached tasks (after app restart), `reattachEvents()` does NOT install polling — it only wires the event callbacks that don't work.

**Question for expert:**

- Does the library actually support events on newer RN? The package.json says `react-native: ">=0.60.0"` but was published 2+ years ago — it predates `NativeEventEmitter` being strict about `addListener`.
- Should we install the polling loop in `reattachEvents()` as well?
- Is there a newer fork or should we wrap the native module to inject `addListener`/`removeListeners` stubs?

### 4B. processQueue Re-entrancy

**Symptom:** The same download gets started 3 times. Logs show:

```
[Manager] processQueue — queue length: 1 active: 0 maxConcurrent: 3
[Manager] Starting download for: dl_1785196121708_3wry6s5e
[Manager] processQueue finished — queue length: 0 active: 1
[Manager] processQueue — queue length: 1 active: 1 maxConcurrent: 3  ← 2nd processQueue
[Manager] Starting download for: dl_1785196121708_3wry6s5e
```

**Root cause:** Multiple callers fire `processQueue()` concurrently:

1. `add()` calls `processQueue()` at the end
2. `recoverOnStartup()` (fire-and-forget in constructor) completes and its `onChange` handler fires `processQueue()`
3. Network `onChange` fires `processQueue()`
4. `pause()`/`resume()`/`cancel()` call `processQueue()` in cleanup

The re-entrancy guard (`if (this.processingQueue) return;`) DOES prevent concurrent execution within a single turn of the event loop, BUT **`ProcessingQueue` is set `false` in the `finally` block** — so if processQueue is called AGAIN during the same microtask cycle after the loop finishes but before the previous caller returns, the guard passes.

**Current fix applied:**

- `activeInstances.has(taskId)` check before starting a task (line 344)
- Guard re-entrancy at top of `processQueue` (line 323)

**Question for expert:** Should we switch to a proper **queue state machine**? E.g.:

```typescript
private processQueuePromise: Promise<void> | null = null;
private async processQueue(): Promise<void> {
  if (this.processQueuePromise) return this.processQueuePromise;
  this.processQueuePromise = this._processQueue();
  try { await this.processQueuePromise; }
  finally { this.processQueuePromise = null; }
}
```

This way concurrent calls piggyback on the one in-flight call.

### 4C. recoverStaleTasks() Race with Fresh Adds

**Symptom:** A task enqueued in the current session immediately gets marked as "paused" by startup recovery.

**Root cause:** `DownloadDatabase.recoverStaleTasks()` originally used:

```sql
WHERE status IN ('downloading', 'pending', 'retrying')
```

But `'pending'` status is what `add()` sets on a fresh task. Since `recoverOnStartup()` fires fire-and-forget from the constructor (without `await`), it races with `add()` calls from the UI. If `recoverStaleTasks()` runs after a fresh `add()` writes to DB, it marks the new task as paused.

**Fix applied:** Changed to:

```sql
WHERE status IN ('downloading', 'retrying')
```

Removed `'pending'` from the stale query. This is correct because `pending` tasks from a previous session will stay pending — the user's next `resume()` or the queue draining will pick them up. And new-session `add()` calls don't get trampled.

### 4D. Resume Creates Brand New OS Task

**Symptom:** When user clicks "Resume", `manager.resume()` sets status to "pending" and pushes to queue. Then `processQueue()` calls `startDownload()`, which calls `nativeAdapter.download()`, which calls `RNBackgroundDownloader.createDownloadTask()` with a **new** URL and **new** native task ID.

The old OS DownloadManager task (from the original `createDownloadTask`) is orphaned — it may still be in the Android DownloadManager/ iOS URLSession, and the old bytes ARE on disk, but the new task downloads from scratch.

**Root cause:** The `NativeDownloaderAdapter` has no `resumeExisting()` method. The manager always calls `download()` to create a fresh native task. The `@kesha-antonov/react-native-background-downloader` library provides `task.resume()` on the DownloadTask instance, but the Manager has discarded the instance.

**Current flow:**

```
resume(taskId)
  → DB: status = 'pending', reset resumeData
  → push to queue
  → processQueue()
    → startDownload(task)
      → adapter.download({ url, filePath, headers })  ← always creates NEW native task!
      → nativeTask.start()
```

**Desired flow would be:**

```
resume(taskId)
  → read existing native task if available
  → if exists: nativeTask.resume()
  → if not: create new native task (but reuse file path + offset)
```

**Question for expert:** How should we track the native task instance across pause/resume cycles? Options:

- Store a native task reference in a Map (current approach — but it's discarded on pause)
- Use `RNBackgroundDownloader.getExistingDownloadTasks()` on resume to find it
- Pause should NOT discard the native instance — keep it alive but throttled

### 4E. Polling Fallback Not in reattachEvents()

When `reattachEvents()` is called (after app restart → `recoverExistingDownloads()` → manager wires events), it only calls `nativeTask.progress()`, `nativeTask.done()`, `nativeTask.error()` — but these callbacks rely on `NativeEventEmitter` which is broken.

**Fix needed:** `reattachEvents()` must also install the 1-second polling interval, just like `download()` does on line 128.

### 4F. Double-Completion Risk

Since we have **both** native event callbacks AND polling fallback running simultaneously, a download that completes could trigger `onDone` twice:

1. Via native `done` event callback
2. Via polling detecting `state === 'DONE'`

**Fix applied:** The done handler in polling checks `tracked.cancelled` before calling `onDone`, but if the native event fires first (which deletes the tracked entry from `this.active`), the polling's `this.active.delete()` and `onDone` call happen on an already-cleaned-up task.

This hasn't manifested yet (since events don't fire at all), but it's a latent race.

**Question for expert:** Should we add a `completionGuard` boolean per TrackedDownload to ensure `onDone`/`onError` fire exactly once?

### 4G. Manager Constructor Fires Fire-and-Forget Async

```typescript
constructor(config?: Partial<DownloadConfig>) {
  // ...
  this.recoverOnStartup();  // <-- fire-and-forget promise
}
```

`recoverOnStartup()` is async and runs `DownloadDatabase.recoverStaleTasks()` + iterates all tasks. If the first `add()` call arrives before recovery completes, the DB state is inconsistent.

**Fix:** Changed `recoverOnStartup` to NOT mark `pending` as paused (see 4C). But the race still exists — `add()` might insert a task while recovery is iterating tasks.

**Question:** Should we make `initialize()` an explicit async method the context calls in `useEffect`, rather than a fire-and-forget constructor call?

---

## 5. Open Questions for Expert

1. **Event bridge fix**: Is there a way to make `@kesha-antonov/react-native-background-downloader` events work on RN 0.83? Can we patch the native module to add `addListener`/`removeListeners`? Or should we switch to a different library entirely?

2. **Native task handle**: Should we keep native task handles in memory across pause/resume? If we pause but don't throw away the `TrackedDownload`, we can call `nativeTask.resume()` directly instead of creating a new OS download task.

3. **Queue architecture**: Should `processQueue()` return a shared promise (so concurrent callers piggyback) or should it just be called from exactly one place?

4. **Polling reliability**: The `1s` polling reads `nativeTask.bytesDownloaded` — is this value always populated even when events don't fire? In our testing the value was `0` initially and only updated after the user manually clicked "resume".

5. **Migration data**: Old downloads are in the DB from before the migration ran. Should we `DELETE FROM downloads WHERE status = 'completed'` after migration to force a clean start?

---

## 6. Key Code Snippets

### 6A. nativeAdapter.ts — download() with polling fallback

```typescript
async download(options: DownloadOptions): Promise<DownloadInstance> {
  const id = options.externalId ?? `dl_${Date.now()}_...`;
  const fileName = options.filePath.split("/").pop() ?? `${id}.mp4`;
  const destination = `${DOWNLOAD_DIR}${this.sanitizeFileName(fileName)}`;

  // Create native download task
  const nativeTask = RNBackgroundDownloader.createDownloadTask({
    id, url: options.url, destination,
    headers: { ...options.headers },
    metadata: { fileName, externalId: options.externalId ?? id },
  });

  const tracked = { nativeTask, options, paused: false, cancelled: false };
  this.active.set(id, tracked);

  // Wire native events (these DON'T FIRE in practice)
  nativeTask.begin((params) => { ... });
  nativeTask.progress((params) => { ... });
  nativeTask.done((params) => { ... });
  nativeTask.error((params) => { ... });

  nativeTask.start();

  // Polling fallback (1s interval)
  const pollInterval = setInterval(() => {
    if (tracked.cancelled || tracked.paused) return;
    const downloaded = nativeTask.bytesDownloaded;
    const total = nativeTask.bytesTotal;
    if (downloaded > 0 && total > 0) {
      options.onProgress?.(downloaded, total);
    }
    if (nativeTask.state === 'DONE' && total > 0) { ... }
    if (nativeTask.state === 'FAILED') { ... }
  }, 1000);

  return { id, pause: ..., resume: ..., cancel: ... };
}
```

### 6B. manager.ts — processQueue with re-entrancy guard

```typescript
private async processQueue(): Promise<void> {
  if (this.processingQueue) return; // re-entrancy guard
  this.processingQueue = true;
  try {
    while (this.queue.length > 0 &&
           this.activeInstances.size < this.config.maxConcurrent) {
      if (!this.networkPolicy.canDownload()) break;

      const taskId = this.queue.shift()!;
      if (this.activeInstances.has(taskId)) continue; // duplicate guard

      const task = await DownloadDatabase.getById(taskId);
      if (!task || ["completed","cancelled"].includes(task.status)) continue;

      await this.startDownload(task);
    }
  } finally {
    this.processingQueue = false;
  }
}
```

### 6C. manager.ts — startDownload flow

```typescript
private async startDownload(task: DownloadTask): Promise<void> {
  // 1. DB → status: downloading
  // 2. Initialize SpeedTracker, liveReceived/liveTotal maps
  // 3. Build Range header if resumeData exists
  // 4. adapter.download({ url, filePath, headers, onProgress, onDone, onError })
  // 5. activeInstances.set(taskId, instance)
}
```

### 6D. manager.ts — recoverOnStartup (fire-and-forget from constructor)

```typescript
private async recoverOnStartup(): Promise<void> {
  // Mark stale 'downloading'/'retrying' as 'paused'
  const staleCount = await DownloadDatabase.recoverStaleTasks();

  // Check for OS-completed downloads
  const allTasks = await DownloadDatabase.getAll();
  for (const task of allTasks) {
    if (task.status !== "downloading") continue;
    const filePath = this.adapter.getDestinationPath(...);
    const info = await getInfoAsync(filePath);
    if (info.exists && info.size > 0) {
      // OS completed it while we were dead → mark complete
    } else {
      // File gone → mark paused
    }
  }
}
```

---

## 7. System File Tree (Current State)

```
apps/mobile/lib/download/
├── adapter.ts              ← Interface (updated with resumeExisting)
├── database.ts             ← SQLite (NOW: stale recovery skips 'pending')
├── index.ts                ← Public exports
├── manager.ts              ← Orchestrator (processQueue, retry, network)
├── migration.ts            ← One-time migration from old system
├── nativeAdapter.ts        ← OS download via @kesha-antonov (POLLING FALLBACK)
├── networkPolicy.ts        ← WiFi/cellular awareness
├── notifications.ts        ← expo-notifications wrapper
├── storageManager.ts       ← Space checks + LRU eviction
├── store.ts                ← In-memory + SQLite sync
├── types.ts                ← All shared types
├── context.tsx              ← React provider
├── useDownload.ts           ← Single-task hook
├── useDownloadList.ts       ← All tasks grouped hook
├── useDownloadQueue.ts      ← Queue state hook
├── useEpisodeDownloads.ts   ← Season-level batch hook
├── utils.ts                 ← Helpers
├── EXPERT_DOC.md            ← Original architecture doc
└── EXPERT_FOLLOWUP.md       ← THIS FILE
```

---

## Appendix: Logs from the Last Test Run

```
[Manager] Creating DownloadManager with config: ...

[NetworkPolicy] Initial state: wifi connected: true

[NativeAdapter] download called: { id: "dl_1785196121708_3wry6s5e", url: "https://...", destination: "..." }
[NativeAdapter] RNBackgroundDownloader module: object
[NativeAdapter] createDownloadTask: function

[Manager] processQueue — queue length: 1 active: 0 maxConcurrent: 3
[Manager] Starting download for: dl_1785196121708_3wry6s5e
[Manager] startDownload: dl_1785196121708_3wry6s5e → filePath

WARN  `new NativeEventEmitter()` was called with a non-null argument
without the required `addListener` method.

WARN  `new NativeEventEmitter()` was called with a non-null argument
without the required `removeListeners` method.

[Manager] processQueue finished — queue length: 0 active: 1
[Manager] processQueue — queue length: 1 active: 1 maxConcurrent: 3  ← queue grew!
[Manager] Task already active, skipping: dl_1785196121708_3wry6s5e  ← guard saved us

[Manager] Recovered 1 stale tasks → paused  ← stale recovery ran AFTER
```

**User reported:** "First it showed file size is 0B, then I clicked on resume, then it showed correct size but did not start."
