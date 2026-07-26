# Filmsnaps Download System — Production Gap Analysis

## Verdict: Functional, Not Production-Grade

Your system handles the **core download loop** correctly (queue → download → pause → resume → complete). It's comparable to a well-built indie app. But YouTube, Netflix, and Spotify download systems operate at a fundamentally different tier. Here's what separates them.

---

## Tier 1: Critical Gaps (Will Cause User-Facing Failures)

### 1. No File Integrity Verification

Your system trusts that the downloaded bytes are correct. A single bit flip, a proxy injecting ads, or a CDN serving a truncated response produces a corrupt file that plays as garbage or crashes the video player.

**YouTube/Netflix do:** SHA-256 checksum verification on every completed download. The server provides the hash; the client verifies after write.

```typescript
// What you need:
interface DownloadMeta {
  // ... existing fields ...
  expectedChecksum?: string; // SHA-256 from server
  expectedFileSize?: number; // Exact byte count from server
}

// In onDone, before marking 'completed':
async function verifyFile(
  filePath: string,
  expected: { size?: number; sha256?: string },
): Promise<boolean> {
  const rnfb = getRNFB();
  const stat = await rnfb.fs.stat(filePath);

  // Size check (fast)
  if (expected.size && Number(stat.size) !== expected.size) {
    return false;
  }

  // Hash check (slower but definitive)
  if (expected.sha256) {
    // RNFB doesn't have native SHA-256 — use react-native-quick-crypto
    // or expo-crypto's digestStringAsync on chunks
    const hash = await computeFileSHA256(filePath);
    if (hash !== expected.sha256) {
      return false;
    }
  }
  return true;
}
```

### 2. No Network State Awareness

Your download continues blindly when the user loses WiFi, switches to cellular, or enters airplane mode. This burns the user's data plan and produces failed downloads that trigger your retry loop pointlessly.

**YouTube does:** Listens to `NetInfo`, pauses on network loss, shows "Waiting for WiFi" state, resumes automatically on reconnect.

```typescript
// What you need:
import NetInfo from '@react-native-community/netinfo';

// In DownloadManager:
private networkState = { connected: true, isWifi: true, type: 'wifi' };

async initialize() {
  // ... existing recovery logic ...

  NetInfo.addEventListener((state) => {
    const wasConnected = this.networkState.connected;
    this.networkState = {
      connected: state.isConnected ?? false,
      isWifi: state.type === 'wifi',
      type: state.type,
    };

    if (!state.isConnected && wasConnected) {
      this.pauseAllActive('Network lost');
    } else if (state.isConnected && !wasConnected) {
      this.resumeAutoPaused();
    }
  });
}

// User setting: WiFi-only downloads
private wifiOnly = false;

setWifiOnly(enabled: boolean) {
  this.wifiOnly = enabled;
  if (enabled && !this.networkState.isWifi) {
    this.pauseAllActive('Waiting for WiFi');
  } else if (!enabled || this.networkState.isWifi) {
    this.resumeAutoPaused();
  }
}
```

### 3. No Pre-Download Storage Validation

You start a 200MB download without checking if the device has 200MB free. The download fails at 95% with `ENOSPC`, wasting the user's time and bandwidth.

**YouTube does:** Checks available storage before enqueueing. Shows "Not enough storage" immediately.

```typescript
// In add() or enqueue(), before starting:
async validateStorage(requiredBytes: number): Promise<{ ok: boolean; available: number }> {
  const available = await this.adapter.getAvailableStorage();
  const headroom = 50 * 1024 * 1024; // 50MB safety margin
  return {
    ok: available > requiredBytes + headroom,
    available,
  };
}
```

### 4. No Stalled Download Watchdog

If the server stops sending data (connection hangs without closing), your download sits at 45% forever. The 30-minute timeout is too long, and there's no per-chunk stall detection.

**YouTube does:** If no bytes received for 30 seconds, kill the connection and retry from the last checkpoint.

```typescript
// In startDownload's onProgress:
let lastByteTime = Date.now();

onProgress: (received, total) => {
  lastByteTime = Date.now();
  // ... existing logic ...
},

// Watchdog interval (separate from progress):
const stallWatchdog = setInterval(() => {
  if (Date.now() - lastByteTime > 30_000 && !state.paused && !state.cancelled) {
    console.warn(`[Manager] Download stalled for 30s, restarting connection`);
    clearInterval(stallWatchdog);
    // Cancel and re-enqueue with current resumeData
    instance.cancel().then(() => {
      this.liveReceivedBytes.set(taskId, maxReceivedSeen);
      this.handleStall(taskId, maxReceivedSeen);
    });
  }
}, 10_000);
```

---

## Tier 2: Important Gaps (Degrade Reliability at Scale)

### 5. No Multi-Connection Downloading

You download a 200MB file over a single TCP connection. On a 100Mbps connection, you get ~12MB/s. YouTube splits the file into 4-8 parallel Range requests, saturating the connection at ~50MB/s.

```
Your system:     [========single connection========]  → 12 MB/s
YouTube:         [==conn1==][==conn2==][==conn3==][==conn4==]  → 48 MB/s
```

This requires a segmented download architecture where each segment is a separate Range request, written to a separate temp file, then concatenated.

### 6. No Download Expiry / License Management

YouTube downloads expire after 30 days. Netflix requires periodic license renewal. Your downloads persist forever with no server-side validation.

```typescript
interface DownloadTask {
  // ... existing ...
  expiresAt?: number; // Timestamp when download becomes invalid
  licenseToken?: string; // DRM license if applicable
  lastLicenseCheck?: number; // When we last validated with server
}
```

### 7. No Crash-Safe Write-Ahead Logging

If the app crashes mid-download, your SQLite database might have `status='downloading'` with stale `receivedBytes`. Your `recoverStaleTasks()` marks them as paused, but the actual file on disk might be ahead of or behind the DB record.

**Production systems use:** WAL-mode SQLite + atomic rename pattern (write to `.tmp`, rename to final on completion).

```typescript
// In database initialization:
await database.execAsync("PRAGMA journal_mode=WAL;");
await database.execAsync("PRAGMA synchronous=NORMAL;");
```

### 8. No Download Scheduling

YouTube lets users schedule downloads for WiFi-only or overnight. Your system starts immediately on enqueue with no scheduling options.

```typescript
interface DownloadSchedule {
  wifiOnly: boolean;
  startAfter?: number; // Timestamp
  endBefore?: number; // Timestamp
  chargingOnly: boolean; // Only download while charging
}
```

### 9. No Batch / Season Download Management

Your queue handles individual files. Netflix/YouTube handle "Download entire season" (10-20 episodes) with:

- Priority ordering (episode 1 first)
- Aggregate progress across all episodes
- "Cancel season" as a single action
- Smart ordering (download while watching next episode)

### 10. No CDN Failover / URL Rotation

Your download URL is fixed. If the CDN node is slow or returns errors, you retry the same URL. Production systems rotate between multiple CDN endpoints.

```typescript
interface DownloadMeta {
  urls: string[]; // Multiple CDN URLs for the same file
  urlIndex: number; // Current URL being tried
  urlFailCounts: number[]; // Failure count per URL
}
```

---

## Tier 3: Polish Gaps (What Users Notice)

### 11. No Download Speed Graph / History

YouTube shows a real-time speed graph. You show a single speed number that fluctuates wildly.

### 12. No "Downloading While Watching" Priority

YouTube/Netflix prioritize the episode you're about to watch next. Your queue is FIFO with static priority.

### 13. No Download Quality Auto-Selection

YouTube auto-selects quality based on available storage and network speed. Your system downloads whatever URL is provided.

### 14. No Progress in Notification Actions

Android notifications should have Pause/Cancel buttons directly in the notification shade. Your notifications are informational only.

### 15. No Storage Usage Visualization

YouTube shows a breakdown: "Downloads: 2.3 GB | Available: 12.1 GB" with per-title sizes. Your `getStorageInfo()` returns raw numbers with no UI.

### 16. No Download Analytics / Telemetry

YouTube tracks: success rate, average speed, failure reasons, resume frequency, time-to-complete. You have `console.log` statements.

```typescript
interface DownloadAnalytics {
  taskId: string;
  startTime: number;
  endTime?: number;
  totalBytes: number;
  resumeCount: number;
  errorCount: number;
  avgSpeed: number;
  networkType: string;
  cdnNode: string;
  outcome: "completed" | "failed" | "cancelled";
  failureReason?: string;
}
```

---

## Tier 4: Architecture Gaps (Structural Limitations)

### 17. No True Background Download (Android WorkManager)

Your foreground service keeps the app alive, but Android can still kill it under memory pressure. YouTube uses `WorkManager` with `setRequiredNetworkType()` and `setRequiresStorageNotLow()` for OS-managed background downloads that survive app death.

### 18. No iOS Background Task Support

iOS gives you ~30 seconds of background execution via `BGTaskScheduler`. Your system has no iOS background strategy. Downloads stop when the app is backgrounded.

### 19. No Database Migration Strategy

Your `initializeDatabase` has a basic column-existence check. Production systems use versioned migrations:

```typescript
const MIGRATIONS = [
  { version: 1, sql: CREATE_TABLE },
  { version: 2, sql: "ALTER TABLE downloads ADD COLUMN expires_at INTEGER;" },
  { version: 3, sql: "ALTER TABLE downloads ADD COLUMN checksum TEXT;" },
  {
    version: 4,
    sql: "CREATE INDEX idx_downloads_expires ON downloads(expires_at);",
  },
];
```

### 20. No Test Coverage

No unit tests, no integration tests, no network-condition simulation tests. Your debugging has been entirely log-based across 5 rounds.

---

## Comparison Matrix

| Capability                | Filmsnaps             | YouTube         | Netflix              |
| ------------------------- | --------------------- | --------------- | -------------------- |
| Basic download            | ✅                    | ✅              | ✅                   |
| Pause / Resume            | ✅                    | ✅              | ✅                   |
| Progress UI               | ✅                    | ✅              | ✅                   |
| Queue management          | ✅                    | ✅              | ✅                   |
| File integrity check      | ❌                    | ✅ SHA-256      | ✅ + DRM             |
| Network awareness         | ❌                    | ✅              | ✅                   |
| Storage pre-check         | ❌                    | ✅              | ✅                   |
| Multi-connection          | ❌                    | ✅ (4-8)        | ✅                   |
| Stall detection           | ❌ (30min timeout)    | ✅ (30s)        | ✅                   |
| WiFi-only mode            | ❌                    | ✅              | ✅                   |
| Download scheduling       | ❌                    | ✅              | ✅                   |
| Batch / season            | ❌                    | ✅              | ✅                   |
| CDN failover              | ❌                    | ✅              | ✅                   |
| DRM / encryption          | ❌                    | ✅ Widevine     | ✅ Widevine/FairPlay |
| Download expiry           | ❌                    | ✅ 30 days      | ✅ 7-30 days         |
| True background (Android) | ⚠️ Foreground service | ✅ WorkManager  | ✅ WorkManager       |
| Background (iOS)          | ❌                    | ✅ BGTask       | ✅ BGTask            |
| Crash recovery            | ⚠️ Basic              | ✅ WAL + atomic | ✅                   |
| Analytics / telemetry     | ❌                    | ✅              | ✅                   |
| Test coverage             | ❌                    | ✅              | ✅                   |
| Notification actions      | ❌                    | ✅              | ✅                   |

---

## Recommended Priority Order

If you're shipping to real users, fix these first:

| Priority | Item                                               | Effort  | Impact                                 |
| -------- | -------------------------------------------------- | ------- | -------------------------------------- |
| **P0**   | Network state awareness (pause on loss, WiFi-only) | 1 day   | Prevents data waste + failed downloads |
| **P0**   | Pre-download storage check                         | 2 hours | Prevents 95% failures                  |
| **P0**   | Stall watchdog (30s, not 30min)                    | 4 hours | Prevents infinite hangs                |
| **P1**   | File integrity verification (size + hash)          | 1 day   | Prevents corrupt files                 |
| **P1**   | SQLite WAL mode + crash-safe writes                | 4 hours | Prevents DB corruption                 |
| **P1**   | Notification with Pause/Cancel actions             | 1 day   | UX expectation                         |
| **P2**   | Download analytics / error tracking                | 2 days  | Visibility into failures               |
| **P2**   | Batch season download                              | 2 days  | Feature parity                         |
| **P2**   | Download scheduling (WiFi-only, time-based)        | 2 days  | User control                           |
| **P3**   | Multi-connection download                          | 1 week  | 3-4x speed improvement                 |
| **P3**   | CDN failover / URL rotation                        | 3 days  | Reliability                            |
| **P3**   | True background via WorkManager                    | 1 week  | Survives app death                     |

Your download **engine** is solid after 5 rounds of fixes. What's missing is the **operational layer** around it — the defensive systems that handle the chaos of real-world networks, storage, and user behavior.
