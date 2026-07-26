# Filmsnaps Download System — Expert Follow-Up

## What We Implemented From Your Previous Advice

We applied all 5 fixes exactly as specified:

### Fix 1: `store.ts`

- `upsert()` now updates in-memory state **synchronously first**, then persists to DB (fire-and-forget)
- For existing tasks, uses `db.update()` (partial fields) instead of `db.insert()` (full `INSERT OR REPLACE`)
- Removed the debounced `persistAll()` pattern entirely

### Fix 2: `manager.ts`

- `pause()` now passes `resumeData` through `emitStatus()` so the event carries it
- `resume()` completely rewritten: validates `resumeData`, checks partial file on disk, resets to 0 on mismatch
- `processQueue()` re-reads task from DB (not stale map)
- `startDownload()` re-reads from DB immediately before starting, validates partial file on disk
- `emitStatus()` now accepts optional `resumeData`

### Fix 3: `context.tsx`

- Progress handler explicitly preserves `existing.resumeData`
- Status handler only sets `resumeData` when the event explicitly provides it (never overwrites with stale in-memory value)

### Fix 4: `database.ts` — Already correct (uses `!== undefined`), no change needed

### Fix 5: `useDownload.ts`

- Added `useRef`-based snapshot caching for stable `useSyncExternalStore` references

### Fix 6: Complete robust `resume()` — applied (see Fix 2)

### Fix 7: `blobDownloader.ts`

- Added `isRangeRequest` flag, logs Range header value
- Added HTTP 200 vs 206 detection (server ignoring Range header)

---

## Current Logs After Applying All Fixes

```
 LOG  [Manager] processQueue: queue=0, active=0, processing=true
 LOG  [Manager] processQueue: queue=0, active=0, processing=true
 WARN  SafeAreaView has been deprecated...
 ERROR  VirtualizedLists should never be nested inside plain ScrollViews...
 LOG  [Enqueue] Download URL: https://download-falix-falixmovies-backend-hf.hf.space/dl/...
 LOG  [Enqueue] File: Silo-480p.mkv, Server: falix, Speed limit: 0 B/s
 LOG  [Manager] processQueue: queue=1, active=0, processing=true
 LOG  [Manager] Starting Foreground Service for downloads
 LOG  [Manager] Starting download: https://download-falix-.../Silo%20S03E01%20...x264-Falix.mkv
 LOG  [Manager] File: Silo-480p.mkv, Resume: false, ResumeOffset: 0, Path: /storage/.../Filmsnaps/Silo-480p.mkv, Speed limit: 0
 LOG  [BlobDownloader] Full-speed download: .../Silo%20S03E01%20...x264-Falix.mkv, Range: none
 LOG  [BlobDownloader] Created download: dl_1785002544872_qefeeh, speedLimit: 0
 LOG  [Manager] activeInstances set for dl_1785002543527_d9yldn, count=1, queue=0
 LOG  [BlobDownloader] Progress: 9.1MB / 201.0MB (4.5%)
 LOG  [BlobDownloader] Progress: 21.3MB / 201.0MB (10.6%)
 LOG  [BlobDownloader] Progress: 30.6MB / 201.0MB (15.2%)
 LOG  [BlobDownloader] Download paused: dl_1785002544872_qefeeh, received=33919413/210739946
 LOG  [Manager] processQueue: queue=0, active=0, processing=true
 LOG  [Manager] resume: file size 34419116 > resumeOffset 9523646, using resumeOffset   ← WRONG offset!
 LOG  [Manager] processQueue: queue=1, active=0, processing=true
 LOG  [Manager] Starting Foreground Service for downloads
 LOG  [Manager] Starting download: https://download-falix-.../Silo%20S03E01%20...x264-Falix.mkv
 LOG  [Manager] File: Silo-480p.mkv, Resume: true, ResumeOffset: 9523646, Path: /storage/.../Filmsnaps/Silo-480p.mkv.resume, Speed limit: 0
 LOG  [BlobDownloader] Full-speed download: .../Silo%20S03E01%20...x264-Falix.mkv, Range: bytes=9523646-
 LOG  [BlobDownloader] Created download: dl_1785002582685_67nqey, speedLimit: 0
 LOG  [Manager] activeInstances set for dl_1785002543527_d9yldn, count=1, queue=0
 LOG  [BlobDownloader] Progress: 11.8MB / 191.9MB (6.1%)
 LOG  [BlobDownloader] Download paused: dl_1785002582685_67nqey, received=18942823/201216300
 LOG  [Manager] processQueue: queue=0, active=0, processing=true
 WARN  [Manager] resume: file size 34419116 < resumeOffset 95236469603970, resetting    ← CORRUPTED value!
 LOG  [Manager] processQueue: queue=1, active=0, processing=true
 LOG  [Manager] Starting Foreground Service for downloads
 LOG  [Manager] Starting download: https://download-falix-.../Silo%20S03E01%20...x264-Falix.mkv
 LOG  [Manager] File: Silo-480p.mkv, Resume: false, ResumeOffset: 0, Path: /storage/.../Filmsnaps/Silo-480p.mkv, Speed limit: 0
 LOG  [BlobDownloader] Full-speed download: .../Silo%20S03E01%20...x264-Falix.mkv, Range: none
 LOG  [BlobDownloader] Created download: dl_1785002603192_2qlgkf, speedLimit: 0
 LOG  [Manager] activeInstances set for dl_1785002543527_d9yldn, count=1, queue=0
 LOG  [BlobDownloader] Progress: 9.8MB / 201.0MB (4.9%)
 LOG  [BlobDownloader] Download paused: dl_1785002603192_2qlgkf, received=15724133/210739946
 LOG  [Manager] processQueue: queue=0, active=0, processing=true
```

---

## Identified Issues

### Issue 1: Wrong `resumeData` value used

```
[Manager] resume: file size 34419116 > resumeOffset 9523646, using resumeOffset
```

File on disk = **34,419,116 bytes** (32.8MB). `resumeData` in DB = **9,523,646** (9.1MB). The log says "using resumeOffset" — it resumes at 9.5MB, re-downloading 23MB already on disk.

Root cause: The `onProgress` callback DB write is throttled to every 2 seconds. The last save happened at 9.1MB. The download continued to 30.6MB before user paused, but `pause()` reads `resumeData` from DB which still has the old 9.1MB value.

### Issue 2: Corrupted `resumeData` value on second pause

```
resumeData: 95236469603970
```

Original `resumeData` was `9523646` (9.5MB). Corrupted value = `9523646` + `9603970` concatenated. The actual file is 34MB. This causes the resume validation to fail and restart from 0.

### Issue 3: Duplicate `processQueue` logs

Two identical entries for `processQueue: queue=0, active=0, processing=true`, suggesting `processQueue` is called twice concurrently before the re-entrancy flag is set.

### Issue 4: Active task ID mismatch (cosmetic)

BlobDownloader creates instances with ID `dl_1785002544872_qefeeh`, but Manager stores under `dl_1785002543527_d9yldn` (different). Not a functional bug but confusing.

### Issue 5: Progress UI not confirmed fixed

Applied Fix 1 (sync in-memory) and Fix 5 (snapshot caching), but this test focused on pause/resume. Not confirmed whether UI progress bar updates past 9.5MB.

---

## Questions for Expert

### Q1: How to fix the 2-second resumeData window?

The progress callback throttles DB writes to 2s intervals. When the user pauses, the last 2 seconds of progress (potentially 20MB+) are lost. Should `pause()`:

a) Read `maxReceivedSeen` from the in-memory speed tracker before deleting it?
b) Write a final sync update to DB before reading `resumeData` back?
c) Remove the 2-second throttle entirely?

### Q2: What causes the corrupted resumeData (95 trillion)?

The value `95236469603970` appears to be concatenation of two numbers. `resumeData` is set as `String(maxReceivedSeen)` — a simple number-to-string conversion. Could this be caused by two concurrent `onProgress` callbacks racing to write to DB, or a stale object being passed to `store.upsert()` that carries an intermediate `resumeData` value?

### Q3: Why does `processQueue` run twice when re-entrancy guard should block?

Two identical `processQueue: queue=0, active=0, processing=true` logs appear. Could there be a microtask ordering issue where both calls pass the `if (this.processingQueue) return;` guard before the first sets the flag?

### Q4: Should pause() use in-memory tracker data instead of DB?

Should `pause()` read `maxReceivedSeen` from `activeSpeedTrackers` BEFORE deleting it, instead of reading stale `resumeData` from DB?

### Q5: Is the progress UI update actually fixed?

We applied Fix 1 (sync in-memory update) and Fix 5 (snapshot caching). Are there any OTHER potential causes of the UI freeze that we missed?

---

Please provide **exact implementation code** for all fixes. Do not write pseudo-code.
