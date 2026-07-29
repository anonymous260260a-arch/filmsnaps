# Filmsnaps Download System — Bug Report #3: Actual Architecture

🚨 **WARNING:** A previous version of this document incorrectly described the app as using `@kesha-antonov/react-native-background-downloader`. That was WRONG. This corrected version describes the **actual** architecture.

---

## 0. Actual Architecture (Not External Library)

This app uses a **custom native module** `FilmsnapsDownloader` with plugin sources at `plugins/with-filmsnaps-downloader/`:

```
UI components
    ↓ enqueue()
context.tsx (DownloadInfraProvider)
    → store.upsert()          (in-memory + SQLite)
    → manager.add()           (DownloadManager)
        ↓
DownloadManager (manager.ts)
    ├── processQueue()        (max 3 concurrent)
    ├── startDownload()       (initiates native download)
    ├── pause/resume/cancel
    └── handleNativeDone/handleNativeError/retry
        ↓
NativeDownloaderAdapter (nativeAdapter.ts)
    └── uses NativeDownloadBridge (nativeBridge.ts)
        ↓
NativeDownloadBridge (nativeBridge.ts)
    ├── FilmsnapsDownloader.startDownload()   ← native module
    ├── FilmsnapsDownloader.pauseDownload()
    ├── FilmsnapsDownloader.resumeDownload()
    ├── FilmsnapsDownloader.cancelDownload()
    └── Events via NativeEventEmitter:
        ├── onDownloadProgress  → adapter.onProgress
        ├── onDownloadComplete  → adapter.onComplete
        ├── onDownloadError     → adapter.onError
        └── onDownloadPaused    → adapter.onPaused
```

### Native Module: Android (Kotlin)

File: `plugins/with-filmsnaps-downloader/files/FilmsnapsDownloadModule.kt`

- Uses Android's `DownloadManager` API
- **Critical path detail**: Calls `setDestinationInExternalFilesDir(reactContext, Environment.DIRECTORY_DOWNLOADS, "Filmsnaps/$safeName")`
  - Actual path: `file:///storage/emulated/0/Android/data/app.filmsnaps.mobile/files/Download/Filmsnaps/{fileName}`
- Progress: Polling via Handler (every 500ms) querying DownloadManager cursor
- Completion: BroadcastReceiver listening for `DownloadManager.ACTION_DOWNLOAD_COMPLETE`
- Pause: Reads bytes from cursor → `downloadManager.remove(nativeId)` → emit event (destructive — you lose the OS task handle)
- Resume: Starts a NEW OS download with `Range: bytes=N-` header
- Events: `onDownloadProgress`, `onDownloadComplete`, `onDownloadError`, `onDownloadPaused`
- Implements `addListener`/`removeListeners` for RN 0.83 NativeEventEmitter compatibility

### Native Module: iOS (Swift)

File: `plugins/with-filmsnaps-downloader/files/FilmsnapsDownloader.swift`

- Uses `URLSessionDownloadTask` with background session (identifier: `app.filmsnaps.mobile.downloads`)
- **Critical path detail**: Saves to app's `documentDirectory/Filmsnaps/` (in the Documents directory)
- Pause: `task.cancel(byProducingResumeData:)` → stores resume data in UserDefaults
- Resume: Reads resume data from UserDefaults → creates via `downloadTask(withResumeData:)`
- Events: Same event names, has `hasListeners` guard, uses `startObserving()`/`stopObserving()`

---

## Why the Logs Show Path Mismatch

The adapter's `getDocDir()` function resolves to:

```
file:///data/user/0/app.filmsnaps.mobile/files/Filmsnaps/   ← internal files dir
```

But the Android native module's `setDestinationInExternalFilesDir` with `DIRECTORY_DOWNLOADS` resolves to:

```
file:///storage/emulated/0/Android/data/app.filmsnaps.mobile/files/Download/Filmsnaps/   ← external / public
```

**These are DIFFERENT paths.** The adapter tells the UI one path, the native module saves to another. At completion, the adapter's `done` event provides the native module's actual path via the `filePath` field in the `onDownloadComplete` event — but `handleNativeDone` then calls `getInfoAsync` on the **adapter's calculated path**, not the actual path.

---

## 1. Full Bug Listing

### Bug A: `getInfoAsync` throws deprecation error → completed downloads marked as failed

**Severity: CRITICAL** — prevents ANY download from completing on SDK 55.

**Log evidence:**

```
[DL] Adapter complete: task=dl_... totalBytes=817652426
[DL] Manager handleNativeDone: filePath=...
WARN  Method getInfoAsync imported from "expo-file-system" is deprecated.
ERROR [DL] Manager handleNativeDone: file verify failed — falling back to failTask:
       [Error: Method getInfoAsync imported from "expo-file-system" is deprecated.]
[DL] Manager failTask: status=failed
```

**Root cause:** `manager.ts` line 8 imports `import * as FileSystem from "expo-file-system"` (the modern API). In SDK 55, calling legacy methods like `getInfoAsync` on this import **throws a runtime error** — it doesn't just warn. Three call sites affected: lines 138, 605 in manager.ts.

`storageManager.ts` and `migration.ts` also have similar issues — they import from `expo-file-system/legacy` where `documentDirectory` can be `null` in SDK 55.

**Fix needed:**

```typescript
// Instead of:
import * as FileSystem from "expo-file-system"; // ← THROWS

// Use either:
import { getInfoAsync } from "expo-file-system/legacy"; // ← deprecated but works
// Or modern API:
import { File } from "expo-file-system";
const file = new File(filePath);
const exists = file.exists;
const size = file.size;
```

---

### Bug B: Double extension on file name (`.mkv.mp4`)

**Severity: HIGH**

**Log evidence:**

```
fileName=House_of_the_Dragon-720p.mkv.mp4
```

**Root cause:** `DownloadMeta.fileName` = `"House of the Dragon-720p.mkv"` (already has `.mkv` extension). But the manager's path construction appends `task.extension ?? "mp4"` unconditionally. 5 occurrences across `manager.ts` (lines 133, 265, 348, 517) and `storageManager.ts` (line 96).

**Fix needed:** Strip existing extension from `fileName` before appending canonical extension:

```typescript
function buildFileName(fileName: string, extension?: string): string {
  const base = fileName.replace(/\.[a-zA-Z0-9]{2,5}$/, ""); // strip existing ext
  const ext = (extension ?? "mp4").replace(/^\./, "");
  return `${base}.${ext}`;
}
```

---

### Bug C: Adapter path ≠ Native module path (Android)

**Severity: HIGH**

**Log evidence:**

```
Adapter download start: filePath=file:///data/user/0/app.filmsnaps.mobile/files/Filmsnaps/...
Adapter complete:       path=file:///storage/emulated/0/Android/data/app.filmsnaps.mobile/files/Download/Filmsnaps/...
```

**Root cause:** `nativeAdapter.ts` calculates path using:

```typescript
const DOWNLOAD_DIR = `${getDocDir()}Filmsnaps/`; // → internal files dir
```

But Android native module (`FilmsnabsDownloadModule.kt` line 60-63) uses:

```kotlin
setDestinationInExternalFilesDir(
    reactContext,
    Environment.DIRECTORY_DOWNLOADS,
    "Filmsnaps/$safeName"
)
```

This saves to the **external** (public) files directory, not internal. On Android 11+ this is `/storage/emulated/0/Android/data/<package>/files/Download/Filmsnaps/`. On iOS the Swift native module uses `documentDirectory/Filmsnaps/` which matches the adapter's path on iOS.

**Important:** The native library IS saving correctly — the file IS being written. The problem is that `handleNativeDone` doesn't use the actual path from the native completion event. The native event's `filePath` field contains the real path, but the manager ignores it and checks its own calculated path instead.

**Fix needed:** In `handleNativeDone`, use the `filePath` from the adapter's `onDone` callback (which comes from the native module's event) to verify the file, not the adapter's calculated path.

---

### Bug D: `documentDirectory` undefined in storageManager + migration

**Severity: MEDIUM**

Both files directly use:

```typescript
import { documentDirectory, getInfoAsync } from "expo-file-system/legacy";
const DOWNLOAD_DIR = `${documentDirectory ?? ""}Filmsnaps/`;
// → "undefinedFilmsnaps/" when documentDirectory is null on SDK 55
```

`nativeAdapter.ts` already fixed this with a `getDocDir()` fallback. These two files were missed.

---

### Bug E: Pause writes `receivedBytes=0` when no progress events fired

**Severity: MEDIUM**

When a download (e.g. nxsha via hubcloud redirect) starts but stalls before emitting positive progress, the `liveReceived` map stays at 0. Pause then writes `receivedBytes: 0` to DB, losing the task on resume.

**Fix:** Before writing 0, stat the actual file on disk using `getInfoAsync`. If the file exists and has bytes, use those instead.

---

### Bug F: `emitStatus` in `startDownload` missing `fileUri`

**Severity: LOW-MEDIUM**

The status event at `manager.ts` line 593 doesn't include `fileUri`. The context handler falls back to `task.fileUri` which is `null` for newly started tasks. So the store never gets the correct file path for downloaded items.

**Fix:** Include `fileUri: filePath` in the status event.

---

### Bug G: `status=undefined` in progress DB update logs

**Severity: COSMETIC**

The `DownloadDatabase.update()` log at database.ts line 204 always prints `status=${fields.status}` even when only `receivedBytes`/`totalBytes` are being updated.

---

## 2. Questions for Expert

### Q1: Android path mismatch — should adapter use external files dir?

The adapter calculates:

```
file:///data/user/0/app.filmsnaps.mobile/files/Filmsnaps/
```

The Android native module saves to:

```
file:///storage/emulated/0/Android/data/app.filmsnaps.mobile/files/Download/Filmsnaps/
```

Options:

1. **Accept the native module's path** from the completion event's `filePath` field. The `onDownloadComplete` event already includes the real path — the manager just needs to use it.
2. **Align the adapter's path** to match the native module. This means changing `getDocDir()` to return the external files directory on Android.
3. **Change the native module** to save to internal files directory (but `setDestinationInExternalFilesDir` in Kotlin DownloadManager doesn't easily support internal storage).

**Which approach is recommended?** Option 1 seems simplest — the native module already tells us where it saved the file.

### Q2: File extension strategy — should caller strip extension from fileName?

Current data flow:

```
DownloadMeta.fileName = "House of the Dragon-720p.mkv"  ← has .mkv
DownloadMeta.extension = "mp4"                           ← default, mismatched
Manager builds: "${fileName}.${extension}" → "House_of_the_Dragon-720p.mkv.mp4"
```

What's the intended behavior?

- Should `extension` always match the actual file type?
- Should the manager strip existing extension from `fileName` before appending?
- Or should the caller strip the extension and put it in the `extension` field?

### Q3: Android DownloadManager pause is destructive — is this acceptable?

In `FilmsnapsDownloadModule.kt` (Kotlin):

```kotlin
fun pauseDownload(taskId: String, promise: Promise) {
    val nativeId = taskToNativeId[taskId]
    if (nativeId != null) {
        val bytes = queryBytesDownloaded(nativeId)  // reads bytes from cursor
        downloadManager.remove(nativeId)             // REMOVES the OS task!
        // ...
        // On resume: starts a new OS download with Range header
    }
}
```

`downloadManager.remove(nativeId)` kills the OS DownloadManager task. On resume, `resumeDownload` starts a brand new DownloadManager task with a `Range: bytes=N-` header. This means:

- If the app crashes between pause and resume, the partial file is orphaned (no OS task to reattach to)
- If the server doesn't support Range requests, the download starts from scratch

On iOS (`FilmsnapsDownloader.swift`):

```swift
func pauseDownload(...) {
    task.cancel { resumeData in
        // Stores resume data via UserDefaults
    }
}
```

iOS preserves resume data properly via URLSession's built-in resume capability.

**Is the Android destructive pause acceptable?** Or should we keep the native task alive and just skip progress events while paused?

### Q4: Progress polling is native-side (500ms) — does the adapter-level 300ms/1MB throttle double-buffer?

The Android native module polls DownloadManager cursor every 500ms and emits events. Then `nativeAdapter.ts` has its own throttle (300ms / 1MB). Are these layers of throttling causing issues? The log shows progress events arriving at irregular intervals — sometimes within the same millisecond, sometimes 500ms apart.

### Q5: The "show nothing until reopening app" issue — what causes this?

The user reports: "The download manager showed nothing until i reopened app." Log shows:

```
[DL] Store load: loaded 3 tasks
[DL] Context: initializing manager
[DL] Manager initialize done — active=0 queue=1
[DL] Context: initialized — loaded=false  ← loaded=false even after init succeeds!
```

The `loaded=false` in the log despite initialization completing suggests a React state timing issue. The `setLoaded(true)` may race with the first render. What's the correct pattern?

### Q6: Cancel → Add same URL → duplicate + late completion (race)

Log sequence:

```
1. Manager cancel: taskId=A
2. DB update: cancelled
3. Manager remove: taskId=A
4. Context enqueue: new task for same URL
5. Manager add: duplicate found — returning existing  ← finds cancelled in DB??
6. Adapter complete: taskId=A  ← original download still running!
7. Manager handleNativeDone: tries to process old task
8. ERROR: getInfoAsync throws → failTask
```

The cancel didn't reach the native layer in time, so the original download completed after being "cancelled." The `add()` dedup check found a stale record. This sequence could corrupt state.

Should cancel wait for the native task to actually stop before returning? Should `handleNativeDone` check the current DB status and reject if already cancelled?

---

## 3. Logs (from the user's test run)

```
[DL] Store load: loaded 3 tasks
[DL] Manager initialize start — active=0 queue=0
[DL] DB recoverStaleTasks: 0 tasks recovered
[DL] Manager: loaded 3 tasks from DB
[DL] Manager: 1 pending tasks to queue
[DL] Manager initialize done — active=0 queue=1
[DL] Context: initialized — loaded=false

[DL] Manager startDownload: fileName=House of the Dragon-720p.mkv extension=mp4
[DL] Adapter download start: filePath=.../House_of_the_Dragon-720p.mkv.mp4
[DL] Adapter progress: bytes=0/803358799
[DL] Adapter progress: bytes=70078/803358799
...
[DL] Adapter progress: bytes=4068531/803358799

[DL] Manager cancel: taskId=dl_...
[DL] Adapter complete: path=.../Download/Filmsnaps/... totalBytes=817652426
[DL] Manager handleNativeDone: filePath=.../Filmsnaps/...  ← DIFFERENT PATH!
ERROR [DL] Manager handleNativeDone: file verify failed — falling back to failTask
[DL] Manager failTask: status=failed
```

Key observations:

1. **`extension=mp4`** but `fileName` already ends in `.mkv` → double extension `.mkv.mp4`
2. **Adapter path** = `/data/user/0/.../files/Filmsnaps/` but **native path** = `/storage/emulated/0/.../files/Download/Filmsnaps/`
3. **`getInfoAsync` throws** → can't verify file → marked as failed
4. **`loaded=false`** despite successful init
5. **Cancel → late native completion** race
