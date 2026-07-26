# Filmsnaps Download System — Follow-Up 5: UI Freeze After Applying Round 4 Fixes

## Context

Round 4 expert fixes were applied exactly — per-task pause mutex, `.resume` merge on pause, disk-based `resumeData`, `useDownload` debounce guard, `control()` in-flight dedup, orphan cleanup in blobDownloader.

## Current Bug: UI Freezes (JS Thread Blocked)

After applying all Round 4 fixes, "sometimes the UI kind of freezes — clicking any button on the app doesn't work."

**Logs from the freeze state** — there are no crash logs or errors, the UI simply becomes unresponsive for several seconds.

## Likely Cause

The `pause()` method in `manager.ts` now performs **file I/O synchronously in the pause flow**:

```typescript
// PAUSE: Merging .resume into original (100+ MB file)
await this.appendFileStream(resumePath, filePath); // ← BLOCKS JS THREAD
```

The `appendFileStream` method reads/writes files via RNFB in 256KB base64 chunks. For a large `.resume` file (e.g., 50-100MB), this requires **200-400 round trips through the native bridge**, each involving base64 encode/decode. During this time, the JS thread is occupied, and the UI becomes unresponsive.

The full sequence in `pause()` now does:

1. `instance.pause()` — native bridge call
2. `rnfb.fs.exists(filePath)` — native bridge call
3. `rnfb.fs.stat(filePath)` — native bridge call
4. `rnfb.fs.exists(resumePath)` — native bridge call
5. `rnfb.fs.stat(resumePath)` — native bridge call
6. **`appendFileStream(resumePath, filePath)` — 200+ bridge calls** ← BLOCKS
7. `rnfb.fs.unlink(resumePath)` — native bridge call
8. `DownloadDatabase.update(...)` — SQLite write
9. `emitStatus(...)` — React re-render trigger

The frozen state is the JS thread busy with steps 3-6 while the user taps buttons. React cannot process the queued state updates or touch events until `pause()` completes.

The `resume()` method also does steps 2-6 if it finds an orphaned `.resume` file, causing the same freeze on resume.

## The Debounce in useDownload May Make It Worse

When the app freezes during pause, `actionInFlight.current = true` and the 500ms timeout hasn't fired yet. The user taps pause again — but it's blocked by `actionInFlight`. The user then taps other buttons — also blocked by `actionInFlight`.

Additionally, the `finally` block has a `setTimeout(() => { actionInFlight.current = false; }, 500)` — but if the pause itself takes 5 seconds due to file merging, the `actionInFlight` is released after 500ms + 5s = 5.5s. During this window, ALL actions are blocked.

## Questions for Expert

### Q1: Should appendFileStream be deferred or chunked?

The `.resume` file merge is the slowest operation. Options:

- Move the merge to a **background microtask** (fire-and-forget after DB state is saved)
- Read/write in larger chunks (e.g., 1MB instead of 256KB) to reduce bridge round-trips
- Use RNFB's `fs.cp` + `fs.appendFile` or `fs.cat` instead of readStream/writeStream

### Q2: Should pause() be more responsive?

Should `pause()` do the minimal work needed to stop the download and save state (steps 1 + 8 + 9), and defer the `.resume` merge to a separate non-blocking step?

Proposed approach:

```typescript
async pause(taskId: string): Promise<void> {
  // 1. Stop download immediately
  const instance = this.activeInstances.get(taskId);
  if (instance) await instance.pause();

  // 2. Save state from live counters (fast)
  const liveReceived = this.liveReceivedBytes.get(taskId) ?? 0;
  const resumeData = sanitizeResumeData(liveReceived);
  await DownloadDatabase.update({ id: taskId, status: 'paused', resumeData });

  // 3. Clean up maps (fast)
  this.liveReceivedBytes.delete(taskId);
  this.activeInstances.delete(taskId);

  // 4. Defer merge (doesn't block UI)
  this.scheduleResumeMerge(taskId);
}
```

### Q3: Orphan .resume in resume() also blocks

If an orphaned `.resume` file is found during `resume()`, the merge also blocks there. Should this merge also be deferred with a loading state?

### Q4: useDownload debounce too aggressive?

When `actionInFlight` blocks for 500ms after each action, AND the action itself takes 5+ seconds (due to file merge), the debounce window extends to 5.5+ seconds. During this time, even legitimate subsequent actions (like "navigate back" or "cancel") are silently dropped. Should the timeout be tied to action completion rather than a fixed delay?

---

Please provide **exact implementation code** for all fixes. Do not write pseudo-code or partial changes.
