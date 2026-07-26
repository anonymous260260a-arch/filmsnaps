# Filmsnaps Download System — Follow-Up 3: Live Counters Broken + UI Corruption

## What We Implemented From Your Previous Advice (Round 2)

We applied all 5 fixes from Round 2 exactly as specified:

### Fix 1: `manager.ts` — Live byte counters + sanitizeResumeData + atomic pause

- Added **`liveReceivedBytes`** and **`liveTotalBytes`** maps updated synchronously on every `onProgress` tick
- `pause()` reads from live counters **before** deleting anything (eliminates stale DB window)
- Added `sanitizeResumeData()` — validates at every entry point, rejects concatenated/corrupted values
- Added `externalId: effectiveTask.id` in the `adapter.download()` call

### Fix 2: `store.ts` — Type-safe resumeData handling

- `upsert()` now coerces `task.resumeData` via `String(value)` at both in-memory and DB write paths

### Fix 3: `database.ts` — Force resume_data to TEXT

- `rowToTask`: `String(row.resume_data)` (never returns number)
- `update()`: `String(task.resumeData)` coercion on SQLite parameter binding

### Fix 4: `context.tsx` — resumeData guards

- Progress handler: `existing.resumeData ?? null`
- Status handler: only sets `resumeData` when `s.resumeData !== undefined`

### Fix 5: `blobDownloader.ts` + `adapter.ts` — External ID support

- Added `externalId?: string` to `DownloadOptions` interface
- BlobDownloader uses `options.externalId` as the download instance ID (aligns with Manager task ID)

---

## Current Logs After Applying Round 2 Fixes

```
 LOG  [Enqueue] Download URL: https://download-falix-falixmovies-backend-hf.hf.space/dl/.../Silo%20S03E01%20480p%20English%20WEB-DL%20ESub%20x264-Falix.mkv
 LOG  [Enqueue] File: Silo-480p.mkv, Server: falix, Speed limit: 0 B/s
 LOG  [Manager] Starting download: https://download-falix-.../Silo%20S03E01%20...x264-Falix.mkv
 LOG  [Manager] File: Silo-480p.mkv, Resume: false, ResumeOffset: 0, Path: /storage/.../Filmsnaps/Silo-480p.mkv, Speed limit: 0
 LOG  [BlobDownloader] Full-speed download: .../Silo%20S03E01%20...x264-Falix.mkv, Range: none
 LOG  [BlobDownloader] Created download: dl_1785003619991_h5dwch, speedLimit: 0
 LOG  [Manager] activeInstances set for dl_1785003619991_h5dwch, count=1, queue=0
 LOG  [BlobDownloader] Progress: 9.1MB / 201.0MB (4.5%)
 LOG  [BlobDownloader] Progress: 21.9MB / 201.0MB (10.9%)
 LOG  [BlobDownloader] Progress: 33.6MB / 201.0MB (16.7%)
 LOG  [BlobDownloader] Download paused: dl_1785003619991_h5dwch, received=40341932/210739946
 LOG  [Manager] pause: taskId=dl_1785003619991_h5dwch, liveReceived=9802174, resumeOffset=9802174, resumeData=9802174
 LOG  [Manager] resume: file size 40554942 > resumeOffset 9802174, using resumeOffset
 LOG  [Manager] resume: taskId=dl_1785003619991_h5dwch, validatedResumeData=9802174
 LOG  [Manager] Starting download: .../Silo%20S03E01%20...x264-Falix.mkv
 LOG  [Manager] File: Silo-480p.mkv, Resume: true, ResumeOffset: 9802174, Path: /storage/.../Filmsnaps/Silo-480p.mkv.resume, Speed limit: 0
 LOG  [BlobDownloader] Full-speed download: .../Silo%20S03E01%20...x264-Falix.mkv, Range: bytes=9802174-
 LOG  [BlobDownloader] Created download: dl_1785003619991_h5dwch, speedLimit: 0
 LOG  [Manager] activeInstances set for dl_1785003619991_h5dwch, count=1, queue=0
 LOG  [BlobDownloader] Progress: 9.4MB / 191.6MB (4.9%)
 LOG  [BlobDownloader] Download paused: dl_1785003619991_h5dwch, received=14161697/200937772
 LOG  [Manager] pause: taskId=dl_1785003619991_h5dwch, liveReceived=98021749885446, resumeOffset=98021749885446, resumeData=null
```

---

## Analysis of Remaining Issues

### Issue 1: `liveReceived` is STALE — live counters not working

```
[BlobDownloader] Download paused: dl_1785003619991_h5dwch, received=40341932/210739946
[Manager] pause: taskId=dl_1785003619991_h5dwch, liveReceived=9802174, ...
```

The BlobDownloader reports **40,341,932 bytes** received, but the Manager's `liveReceived` map shows only **9,802,174 bytes** for the **same taskId** (`dl_1785003619991_h5dwch`).

The IDs now match (thanks to `externalId`), yet the live counter has a stale value. Possible causes:

- The `onProgress` callback from `BlobDownloader` fires via `options.onProgress?.(received, total)`, but the Manager's handler does `this.liveReceivedBytes.set(effectiveTask.id, maxReceivedSeen)` — is `effectiveTask.id` stale in the closure?
- Is the `onProgress` lambda in `startDownload()` capturing a different value of `effectiveTask` than expected?
- Could the `activeDownloads` map in BlobDownloader be storing the state under a different key than the one the Manager uses?

### Issue 2: Concatenation STILL happening despite sanitizeResumeData

```
[Manager] pause: taskId=dl_1785003619991_h5dwch, liveReceived=98021749885446, ...
```

This is `"9802174" + "9885446"` — string concatenation of the initial resume offset (9.8MB) and the FIRST progress value from the resumed download.

The pause() reads `this.liveReceivedBytes.get(taskId) ?? 0`. The value `98021749885446` is in the map as a **number** (JavaScript cannot represent this as a number — it actually loses precision — but the log shows it as a number or string). This means `liveReceivedBytes.set()` was called with a concatenated value.

In the `onProgress` handler:

```typescript
const adjustedReceived = isResume ? resumeOffset + received : received;
```

If both `resumeOffset` and `received` were numbers, `+` would be addition, not concatenation. For concatenation to occur, at least one operand must be a string. This suggests that somewhere in the chain, `resumeOffset` or `received` is being treated as a string.

The `resumeOffset` in `startDownload()` is set via:

```typescript
const rawResumeData = sanitizeResumeData(effectiveTask.resumeData);
if (rawResumeData) {
  resumeOffset = parseInt(rawResumeData, 10);
}
```

`sanitizeResumeData("9802174")` → returns `"9802174"` (a string). Then `parseInt("9802174", 10)` → `9802174` (a number). This should be correct.

So where is the string coming from? One theory: the `onProgress` callback in the Manager's scope captures a variable that was assigned by string somewhere. Another theory: the `adjustedReceived` variable flows through `emitProgress` → `context.tsx` → `store.upsert()` — and somewhere in that chain, a type coercion happens that feeds back into the Manager.

### Issue 3: UI shows impossible values (9128986 GB)

After resume:

- UI shows total size: **9,128,986 GB** (likely `9802174` interpreted as GB due to unit conversion on a corrupted value)
- UI shows downloaded: **91,290 GB**
- Network speed and remaining time also show impossibly huge values

This cascades from the concatenated `resumeData` value. The UI component likely divides by 1024^3 to show GB, and `98021749885446 / (1024^3) ≈ 91,290 GB`.

### Issue 4: Progress bar updates are not streaming

The BlobDownloader progress logs only fire at **9.1MB, 21.9MB, 33.6MB** — very sparse updates. RNFB's `.progress()` fires on chunk boundaries, which for a 200MB file should be much more frequent. Combined with the 10-second throttled log in BlobDownloader, we only see periodic updates.

But even when progress fires, the **UI** jumps from 8KB → 9.1MB → stuck at 9.3MB. The `store.upsert()` synchronous in-memory update should make it visible immediately, but it appears the progress events are either:

- Not reaching the store frequently enough
- Being swallowed by the `if (adjustedReceived < maxReceivedSeen) return;` guard
- Getting overridden by a stale value from another code path

### Issue 5: Resume starts from 0 visually, but Range header is set

After pause/resume, the Manager logs `Resume: true, ResumeOffset: 9802174, Path: ...Silo-480p.mkv.resume` and sets `Range: bytes=9802174-`. But the **UI** shows the download starting from 0 and growing.

This suggests the UI store (`receivedBytes`) is being reset even though the adapter correctly sends the Range request. The `startDownload` sets `liveReceivedBytes.set(effectiveTask.id, resumeOffset)` which is `9802174`, but the store may have been updated by the status handler setting `receivedBytes: 0`.

---

## Questions for Expert

### Q1: Why is `liveReceivedBytes` not matching actual progress?

The BlobDownloader reports 40MB received, but `liveReceivedBytes.get(taskId)` returns only 9.8MB. What could cause this discrepancy?

Our code:

- `startDownload()` initializes: `this.liveReceivedBytes.set(effectiveTask.id, resumeOffset)` (= 0 for fresh download)
- `onProgress` callback does: `this.liveReceivedBytes.set(effectiveTask.id, maxReceivedSeen)` where `maxReceivedSeen = adjustedReceived`
- `pause()` reads: `this.liveReceivedBytes.get(taskId) ?? 0`

The taskId used for `set` and `get` is `effectiveTask.id` — which now equals the adapter's downloadId (via `externalId`). So the key should match. Is there a timing issue where `pause()` reads before the last `onProgress` writes?

### Q2: Why is concatenation (`9802174` + `9885446`) still happening?

We added `sanitizeResumeData()` at every entry point and `String()` coercion in `store.ts`, `database.ts` (both rowToTask and update). How can the concatenation still occur?

Specifically: in `pause()`, `liveReceivedBytes.get(taskId)` returns a number (`98021749885446`). A `Map<number>.get()` returns whatever was `set()`. So `liveReceivedBytes.set(id, value)` was called with `98021749885446` as the value. Where did this concatenated value come from? The only place that sets it is:

```typescript
this.liveReceivedBytes.set(effectiveTask.id, maxReceivedSeen);
```

where `maxReceivedSeen = adjustedReceived = isResume ? (resumeOffset + received) : received`.

Please trace exactly where string concatenation replaces numeric addition.

### Q3: Progress bar is stuck — what's the failure mode?

We see BlobDownloader progress at 9.1, 21.9, 33.6 MB. But the UI:

1. Jumps from 8KB to 9.1MB (no intermediate updates)
2. Gets stuck at 9.3MB
3. After resume, shows corrupted 9128986GB values

Is the `store.upsert()` path blocking or losing updates? The synchronous in-memory update should be immediate. Could `useSyncExternalStore` snapshot caching be returning a stale reference?

### Q4: After resume, UI shows total size as corrupted value

The total file size (210MB) shows as ~9,128,986 GB after resume. This suggests `totalBytes` is being corrupted in the same way as `resumeData`. Where could `totalBytes` be getting concatenated or multiplied?

### Q5: The `emitProgress` → `store.upsert` → React re-render pipeline

We need exact code for the progress → UI pipeline. Specifically:

- Should `emitProgress` directly update a React state (instead of going through store.upsert)?
- Should the progress handler in `context.tsx` bypass `store.upsert` entirely and use a separate fast path?
- Is `useSyncExternalStore` the wrong primitive for high-frequency progress updates?

---

## All Relevant Source Files

### [manager.ts](apps/mobile/lib/download/manager.ts)

Full replacement with live counters. Key sections:

- `pause()` reads `liveReceivedBytes` before cleanup (line ~219)
- `sanitizeResumeData()` function (line ~152)
- `onProgress` in `startDownload()` sets `liveReceivedBytes` (line ~356)
- `externalId: effectiveTask.id` passed to adapter (line ~347)

### [store.ts](apps/mobile/lib/download/store.ts)

- `upsert()` with `String()` coercion on resumeData (line ~147)

### [database.ts](apps/mobile/lib/download/database.ts)

- `rowToTask` uses `String(row.resume_data)` (line ~148)
- `update()` coerces via `String(task.resumeData)` (line ~234)

### [context.tsx](apps/mobile/lib/download/context.tsx)

- Progress handler preserves `existing.resumeData ?? null` (line ~94)
- Status handler guards with `s.resumeData !== undefined` (line ~112)

### [blobDownloader.ts](apps/mobile/lib/download/blobDownloader.ts)

- `download()` uses `options.externalId` as downloadId (line ~145)

### [adapter.ts](apps/mobile/lib/download/adapter.ts)

- `externalId?: string` in `DownloadOptions` (line ~13)

### [useDownload.ts](apps/mobile/lib/download/useDownload.ts)

- Snapshot caching via `useRef` for `useSyncExternalStore`

---

## Verification Checklist (Still Failing)

1. ❌ Start download → progress should stream but only fires at 9/22/33 MB intervals
2. ❌ Pause at ~40MB → `liveReceived` shows 9.8MB instead of 40MB
3. ❌ Resume → `ResumeOffset` is 9.8MB (should be 40MB), resumes from wrong position
4. ❌ Pause again → `liveReceived` shows concatenated corrupted value `98021749885446`
5. ❌ UI shows impossible GB values (~9 million GB) after resume
6. ❌ Speed and remaining time also showing corrupted values

---

Please provide **exact implementation code** for all fixes. Do not write pseudo-code or partial changes. We will apply them exactly as specified.
