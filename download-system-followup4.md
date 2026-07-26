# Filmsnaps Download System — Follow-Up 4: App Freeze + Multi-Pause Race + Resume Resets to 0

## Context

This is the 4th follow-up. Previous rounds fixed:

- **Round 2**: Live byte counters, `sanitizeResumeData()`, `String()` coercion in store/database, `externalId`
- **Round 3**: `toSafeNumber()` in blobDownloader for RNFB bridge string coercion, `Number()` defense in depth in manager/context/useDownload

**Round 3 fixes are working** — no more concatenation corruption (`63356928` instead of `98021749885446`), no more stale counters, progress streams correctly to UI.

## Current Bugs

### Bug 1: App freezes when pause is clicked — pause triggers 6-8 times

Logs show `[PAUSE] Entering pause for taskId=dl_1785005595966_hp9uv5` repeated **8 times** in a row. Each call reads `liveReceivedBytes=89170586` (correct), but they race:

```
LOG  [PAUSE] DB after update: receivedBytes=89170586, resumeData=89170586  ← correct
LOG  [PAUSE] DB after update: receivedBytes=88048255, resumeData=24579785  ← STALE — wrong resumeData!
LOG  [PAUSE] DB after update: receivedBytes=89170586, resumeData=24579785  ← STALE — wrong resumeData!
```

The stale `resumeData=24579785` comes from a **previous pause cycle's data** being mixed in. Multiple concurrent `pause()` calls interleave — the first one cleans up `liveReceivedBytes`/`liveTotalBytes`/`activeInstances` maps, then the subsequent calls find empty maps and fall back to partial DB reads that return residual data.

The `GO_BACK` errors also suggest the navigation is overwhelmed by rapid clicks.

### Bug 2: Resume from high offset resets to 0

The first download sequence:

1. Download to `Silo-480p.mkv` — reaches **53MB** (partial)
2. Pause at 24.5MB → `resumeData=24579785` ✅
3. Resume → Range: `bytes=24579785-` → new data written to `Silo-480p.mkv.resume` ✅
4. Download continues: chunk grows to 64MB → **total adjusted = 24.5MB + 64.5MB = 89MB**
5. Pause at 89MB → `resumeData=89170586` ✅
6. **Resume** → checks original file `Silo-480p.mkv`, finds it's only **53MB**:
   ```
   LOG  [RESUME] file size 53415607 < resumeOffset 89170586, resetting
   ```
7. **Resets to 0** — starts fresh download, losing all progress

**Root cause**: The resume architecture writes Range response bytes to a `.resume` file, but `resume()` only validates the **original** file (`Silo-480p.mkv`). After the first resume cycle, the `.resume` file (`Silo-480p.mkv.resume`) grows with new bytes, while the original file stays at 53MB. On the second resume, `resumeOffset` (89MB) > original file size (53MB) → validation fails → reset.

The code in `startDownload()`:

```typescript
const actualPath = isResume ? `${filePath}.resume` : filePath;
```

And in `resume()`:

```typescript
const filePath = this.buildFilePath(task);
// ... checks only filePath (original), not filePath + ".resume"
```

And in `onDone`:

```typescript
if (isResume && filePath !== finalPath) {
  // appends .resume contents to original file
}
```

### Bug 3: No debounce/guard for multiple rapid pause clicks

When the user taps pause (or the app freezes and all queued taps fire at once), `pause()` runs N times concurrently. Each call:

1. Reads `liveReceivedBytes` (1st call gets 89MB, subsequent calls may get 0 after cleanup)
2. Falls back to DB if live counter is 0
3. Writes to DB (overwriting the correct 89MB with stale/residual data)

The final `resumeData` in DB ends up corrupted with a stale value from a prior cycle.

---

## Relevant Source Files

### [manager.ts](apps/mobile/lib/download/manager.ts)

**`pause()` method** (lines ~240-283) — reads live counters, updates DB, deletes trackers. No mutual exclusion if called multiple times.

**`resume()` method** (lines ~287-344) — validates partial file at `buildFilePath(task)` only. Does NOT check for `.resume` counterpart.

**`startDownload()`** (lines ~570+):

```typescript
const isResume = resumeOffset > 0;
const actualPath = isResume ? `${filePath}.resume` : filePath;
```

- On resume: writes new Range bytes to `filePath + ".resume"`
- On done: appends `.resume` to original file, then deletes `.resume`

**`onDone`** (lines ~677-733):

```typescript
if (isResume && filePath !== finalPath) {
  // append .resume → original file, then unlink .resume
}
```

### [blobDownloader.ts](apps/mobile/lib/download/blobDownloader.ts)

Full-speed download writes to `options.filePath` which becomes `filePath.resume` on resume.

---

## Raw Logs (Full Session)

```
 LOG  [Enqueue] File: Silo-480p.mkv, Server: falix, Speed limit: 0 B/s
 LOG  [START] effectiveTask.resumeData=null, rawResumeData=null, resumeOffset=0, Range=none
 LOG  [START] isResume=false, actualPath=.../Silo-480p.mkv
 LOG  [BlobDownloader] Full-speed download: ... Range: none
 LOG  [BlobDownloader] Progress: 5.3MB / 201.0MB (2.6%)
 LOG  [BlobDownloader] Progress: 10.7MB / 201.0MB (5.3%)
 LOG  [BlobDownloader] Progress: 15.7MB / 201.0MB (7.8%)
 LOG  [BlobDownloader] Progress: 21.1MB / 201.0MB (10.5%)
 LOG  [PAUSE] Entering pause for taskId=dl_1785005595966_hp9uv5  ← x8 repeats!
 LOG  [PAUSE] liveReceivedBytes=24579785, liveTotalBytes=210739946
 ... (repeat 8 times)
 LOG  [BlobDownloader] Download paused, received=24579785/210739946
 LOG  [PAUSE] Final: liveReceived=24579785, resumeOffset=24579785, resumeData=24579785
 ... (repeat 6 times)
 LOG  [PAUSE] DB after update: receivedBytes=24579785, resumeData=24579785  ← correct
 LOG  [RESUME] From DB: status=paused, receivedBytes=24579785, resumeData=24579785
 LOG  [RESUME] Partial file stat: size=53415607 at .../Silo-480p.mkv
 LOG  [RESUME] file size 53415607 > resumeOffset 24579785, using resumeOffset
 LOG  [RESUME] Final: validatedResumeData=24579785
 LOG  [START] effectiveTask.resumeData=24579785, resumeOffset=24579785, Range=bytes=24579785-
 LOG  [START] Partial file stat: size=53415607 at .../Silo-480p.mkv
 LOG  [START] isResume=true, actualPath=.../Silo-480p.mkv.resume  ← Range bytes go to .resume file
 LOG  [BlobDownloader] Full-speed download: ... Range: bytes=24579785-

 [Downloading... chunk progresses from 0MB to 64MB / 177.5MB]

 LOG  [PAUSE] Entering pause for taskId=dl_1785005595966_hp9uv5  ← x8 repeats!
 LOG  [PAUSE] liveReceivedBytes=89170586, liveTotalBytes=210739946  ← 24.5M + 64.5M = 89MB
 ... (repeat 8 times, app freezes)
 LOG  [BlobDownloader] Download paused, received=64590801/186160161
 LOG  [PAUSE] Final: liveReceived=89170586, resumeOffset=89170586, resumeData=89170586
 ... (repeat 6-8 times)
 LOG  [PAUSE] DB after update: receivedBytes=89170586, resumeData=89170586  ← correct
 LOG  [PAUSE] DB after update: receivedBytes=88048255, resumeData=24579785  ← STALE!
 LOG  [PAUSE] DB after update: receivedBytes=89170586, resumeData=24579785  ← STALE!

 LOG  [RESUME] From DB: status=paused, receivedBytes=89170586, resumeData=89170586  ← reads correct version
 LOG  [RESUME] Validated offset: 89170586
 LOG  [RESUME] Partial file stat: size=53415607 at .../Silo-480p.mkv  ← original file is only 53MB!
 LOG  [RESUME] file size 53415607 < resumeOffset 89170586, resetting
 LOG  [RESUME] Final: validatedResumeData=null
 LOG  [START] isResume=false, actualPath=.../Silo-480p.mkv  ← starts from 0!
 LOG  [BlobDownloader] Full-speed download: ... Range: none
 LOG  [PAUSE] Entering pause for taskId=dl_1785005595966_hp9uv5
 LOG  [PAUSE] liveReceivedBytes=3907980  ← only 3.9MB downloaded before pause
 LOG  [BlobDownloader] Download paused, received=3907980/210739946
```

## Questions for Expert

### Q1: Race condition — multiple concurrent pause() calls

`pause()` is called 6-8 times for a single tap action. The subsequent calls race with the first — after the first cleans up `liveReceivedBytes`/`activeInstances`, the later calls produce stale DB writes.

Should `pause()` have a **mutex/lock** per taskId? Or should the UI button be debounced? Where is the duplicate pause being triggered from — is it the React state update causing re-renders that re-fire the pause action?

### Q2: Resume validation only checks original file, ignores .resume file

When `resume()` validates the partial file at `buildFilePath(task)`, it only checks the **original** file path (`Silo-480p.mkv`). After the first resume cycle, the new bytes live in `Silo-480p.mkv.resume`. The original file stays at its pre-resume size (53MB). So when `resumeOffset` (89MB, which is 24.5MB original + 64.5MB chunk) exceeds the original file (53MB), the validation fails and resets to 0.

Should `resume()` check BOTH `filePath` AND `filePath + ".resume"` and sum their sizes? Or should the `.resume` path be the one validated after the first resume cycle?

### Q3: Expected resume file management strategy

What is the intended lifecycle of `.resume` files? Currently:

1. Fresh download → writes to `Silo-480p.mkv`
2. Pause → `resumeData` saved
3. Resume → writes new Range bytes to `Silo-480p.mkv.resume`
4. Download completes → `onDone` appends `.resume` to `Silo-480p.mkv`, then deletes `.resume`

But if the user pauses DURING the resume (step 3-4 gap), the `.resume` file exists with partial data. On next resume:

- `resume()` checks only `Silo-480p.mkv` (still only 53MB)
- The `resumeOffset` is 89MB (53MB original + 36MB in .resume)
- Validation fails → reset

Should `resume()` instead check if a `.resume` file exists and use its size? Or should the pause step in the resume phase concatenate `.resume` back to the original file?

### Q4: Does the resume flow need a complete re-architecture?

The current approach (write Range bytes to a separate `.resume` file, then append on completion) introduces complexity. A simpler alternative:

- Write Range bytes DIRECTLY to the original file (append mode via RNFB writeStream with `append: true`)
- No `.resume` temp file needed
- Always validate the single file on resume
- On completion, verify total file size

Is this viable with `react-native-blob-util`'s fetch API, or does it require a custom write-stream approach?

---

Please provide **exact implementation code** for all fixes. Do not write pseudo-code or partial changes. We will apply them exactly as specified.
