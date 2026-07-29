# Resume Still Fails — Zero Progress Events After Resume

## Current Behavior

Download → pause → resume produces **zero progress events** after the status changes to "downloading". The task stays stuck at the paused byte offset forever.

## Evidence from Logs

```
# ↓ Fresh download works fine — events arrive normally
[DL] Adapter progress: bytes=0/817652426 offset=0 raw=0 delta=0KB        ← first event OK
[DL] Adapter progress: bytes=70078/817652426 offset=0 raw=70078          ← second event OK
[DL] Adapter progress: bytes=831934/817652426 offset=0 raw=831934        ← keeps going
...
[DL] Adapter progress: bytes=10973630/817652426 offset=0 raw=10973630    ← progress at pause

# ↓ Pause works correctly
[DL] Manager pause: liveReceived=10973630
[DL] DB update: status=paused receivedBytes=10973630 resumeData=10973630

# ↓ Resume called — status changes, but ZERO progress events follow
[DL] Manager resume: offsetBytes=10973630 fileName=..._S01E01.mp4
[DL] Adapter resumeDownload: offsetBytes=10973630                         ← adapter got the call
[DL] Manager resume: native adapter returned instance, setting status=downloading
[DL] DB update: status=downloading
[DL] Context status: status=downloading liveBytes=10973630/817652426

# → NO MORE Adapter progress: events  ← THIS IS THE BUG
```

## Root Cause Analysis

The bug is in **nativeAdapter.ts**, in the global progress handler. Here is the exact guard chain that drops the first resume event:

```typescript
NativeDownloadBridge.onProgress((e: ProgressEvent) => {
  // ...deadTasks check passes, tracked download exists...

  // ─── LINE 64: Native reports bytesTotal=-1 for a new Range task ───
  // The new DownloadManager task (created by resume) starts with
  // COLUMN_TOTAL_SIZE_BYTES = -1 because the server's 206 partial
  // response may not include Content-Length, or DownloadManager
  // hasn't determined it yet.
  if (e.bytesTotal < 0) e.bytesTotal = e.bytesDownloaded;
  //  e.bytesTotal = -1 → e.bytesTotal = 0  ← NOW BOTH ARE 0!

  // ─── LINE 65: THIS GUARD SILENTLY DROPS THE EVENT ───
  if (e.bytesDownloaded <= 0 && e.bytesTotal <= 0) return;
  //  e.bytesDownloaded = 0  AND  e.bytesTotal = 0
  //  → BOTH ≤ 0 → RETURN  ← EVENT DROPPED!

  // ─── LINE 70-71: The offset fix never runs ───
  const offset = this.resumeOffsets.get(e.taskId) ?? 0;
  // offset = 10973630, but we already returned!
});
```

**The chain of events:**

1. Kotlin creates a new DownloadManager task with `Range: bytes=10973630-`
2. Kotlin's first poll reads cursor: `bytesDownloaded=0, bytesTotal=-1`
3. Kotlin emits RAW values: `{ taskId, bytesDownloaded: 0, bytesTotal: -1 }`
4. JS adapter receives the event
5. Line 64: `e.bytesTotal < 0` → clamps to `e.bytesDownloaded` (0) → both are 0
6. Line 65: Guard `if (<=0 && <=0) return;` → **DROPS THE EVENT**
7. The offset of 10973630 is never applied
8. No more events arrive because the DownloadManager task either:
   - Never updates the cursor again (some DownloadManager implementations)
   - Or the next poll also shows 0/-1, and it keeps being dropped

**Why fresh downloads work:** For a fresh (non-resume) download, `bytesTotal` is always positive from the first poll (the server returns Content-Length on the 200 response), so the guard passes.

**Why resume breaks:** For a Range/206 resume, the new DownloadManager task starts with `bytesTotal=-1` because:

- The server may not send Content-Length on a 206 Partial Content
- DownloadManager's COLUMN_TOTAL_SIZE_BYTES may not reflect the remaining content until the first chunk is received

## The Core Problem

The zero-byte guard at line 65 runs **before** the resume offset is added. For a resume task:

- `bytesDownloaded=0, bytesTotal=-1` (raw from cursor)
- After clamping: both 0
- After offset: `absoluteDownloaded=10973630, absoluteTotal=-1` (these would pass the check)
- But the guard runs BEFORE the offset is applied

## Where the Fix Should Go

**Option A — JS fix (OTA, simple):**
Move the guard check to after the offset is applied:

```typescript
const offset = this.resumeOffsets.get(e.taskId) ?? 0;
const absoluteDownloaded = offset + e.bytesDownloaded;
const absoluteTotal = e.bytesTotal > 0 ? offset + e.bytesTotal : -1;

// Guard using absolute values
if (absoluteDownloaded <= 0) return;
```

**Option B — Kotlin fix (native, clean):**
On resume, emit the first progress event with `bytesTotal` set to the offset+remaining (so it's always positive):

```kotlin
// When STATUS_RUNNING and totalBytes is -1, use last known total
sendEvent("onDownloadProgress", Arguments.createMap().apply {
    putString("taskId", taskId)
    putDouble("bytesDownloaded", bytesDownloaded.toDouble())
    putDouble("bytesTotal", if (totalBytes > 0) totalBytes.toDouble() else -1.0)
})
```

Then JS can handle -1 total properly.

## What We Need From You

The native module (Kotlin) needs to be **bulletproof** so we can ship. The JS layer can be fixed via OTA later. Please:

1. **Fix the Kotlin progress polling** so the first event from a resume download always has a positive `bytesTotal`:
   - Store the original `totalBytes` from the DB row when `resumeDownload()` is called
   - When the cursor returns `bytesTotal = -1` (unknown), emit the stored total instead
   - Only emit -1 when there is genuinely no size information available

2. **OR** change the Kotlin emission contract: always emit `bytesTotal = 0` instead of `-1` when unknown, so the JS guard doesn't mutate total to an incorrect value

3. **Kotlin resumeDownload** should also store and forward the original `totalBytes` so JS doesn't lose it after a pause-resume cycle. Currently the first resume event carries no total, and the UI shows `— MB / — MB` until a real progress tick arrives.

## Priority

This is **blocking shipping**. Without resume working, users lose their partial downloads on every pause.
