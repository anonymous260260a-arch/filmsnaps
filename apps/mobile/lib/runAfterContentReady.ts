/**
 * runAfterContentReady — single registry for deferred startup work.
 *
 * Home calls markContentReady() once all three home queries have settled
 * (!isLoading). Tasks registered before that moment run staggered after it;
 * tasks registered after it run immediately (with their own delayMs).
 *
 * Non-essential startup work (speed test, announcements, CW stream prefetch)
 * must go through this helper so it never competes with first paint.
 */

type Task = () => void;

const pending: Array<{ delayMs: number; run: Task }> = [];
let contentReady = false;
let readyAt = 0;

export function markContentReady(): void {
  if (contentReady) return;
  contentReady = true;
  readyAt = Date.now();

  // Sort by delay so registration order does not override stagger intent.
  const tasks = pending.splice(0, pending.length);
  tasks.sort((a, b) => a.delayMs - b.delayMs);
  for (const t of tasks) {
    setTimeout(t.run, t.delayMs);
  }
}

export function isContentReady(): boolean {
  return contentReady;
}

/**
 * Run `task` delayMs after home content is ready (or immediately-ish if
 * content is already ready). delayMs is measured from markContentReady().
 */
export function runAfterContentReady(delayMs: number, task: Task): void {
  if (contentReady) {
    setTimeout(task, delayMs);
    return;
  }
  pending.push({ delayMs, run: task });
}

/** Test/dev helper — reset registry between launches in the same process. */
export function __resetContentReady(): void {
  contentReady = false;
  readyAt = 0;
  pending.length = 0;
}

export function contentReadyAgeMs(): number {
  return contentReady ? Date.now() - readyAt : -1;
}
