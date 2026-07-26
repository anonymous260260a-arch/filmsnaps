# Expert Consultation Response: Remote Configuration & User Feedback System

---

## Executive Summary

Your "GitHub JSON → Cloudflare Worker → Mobile Client" architecture is sound and well-validated by your existing `blocklist.json` pattern. The system you're describing decomposes cleanly into two distinct subsystems with fundamentally different data-flow characteristics:

1. **Remote Config (Capabilities 1–3):** Read-heavy, write-rare, one-to-many broadcast. Your GitHub + Cloudflare Worker approach is ideal here.
2. **User Feedback (Capability 4):** Read-write, many-to-one-to-many, requires persistence, indexing, and notification triggers. This requires a database.

The single most important architectural decision is recognizing that **these two subsystems should not share the same storage mechanism**. The config is a broadcast document; the feedback system is a transactional datastore. Attempting to unify them in a single GitHub JSON file will create concurrency, rate-limiting, and scalability problems.

Below, I address each of your 15 questions in detail.

---

## 4.1 Architecture & Data Flow

### Q1: Overall Architecture

**Recommended architecture:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SOURCE OF TRUTH LAYER                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Private GitHub Repo                                                │
│  ├── config/                                                        │
│  │   ├── remote-config.json    ← announcements, flags, version     │
│  │   └── schema-version.json   ← schema metadata for compatibility │
│  └── (existing) blocklist.json                                      │
│                                                                     │
│  Cloudflare D1 (SQLite)                                             │
│  └── feedback_submissions, feedback_replies tables                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        API LAYER (Cloudflare Workers)                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  GET  /api/config          → serves remote-config.json              │
│  GET  /api/config/flags    → feature flags subset (short TTL)       │
│  GET  /api/blocklist       → (existing)                             │
│                                                                     │
│  POST /api/feedback        → create submission (writes to D1)       │
│  GET  /api/feedback/:uid   → list submissions for a device          │
│  GET  /api/feedback/:id    → get single submission + replies        │
│  POST /api/feedback/:id/reply → dev reply (triggers push notif)     │
│  GET  /api/feedback/admin  → admin list (auth-protected)            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER (Expo RN App)                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  RemoteConfigProvider (React Context)                               │
│  ├── useRemoteConfig() hook                                         │
│  ├── @tanstack/react-query for fetch + cache                        │
│  ├── AsyncStorage for offline fallback                              │
│  └── Polling: on foreground + every 6h (config), 30s (killswitch)  │
│                                                                     │
│  FeedbackModule                                                     │
│  ├── useFeedback() hook (react-query mutations/queries)             │
│  ├── Anonymous device ID (AsyncStorage, UUID v4)                    │
│  └── Reply polling on foreground                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Pitfalls with the "GitHub file → Cloudflare Worker → mobile client" approach:**

| Pitfall                                                                                                                                                                                                                               | Mitigation                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Deploy lag:** Pushing to GitHub doesn't instantly update the Worker. If the Worker reads the file from the repo at build time (bundled), you must redeploy. If it reads at runtime via GitHub API, you add latency and rate limits. | **Recommendation:** Store the JSON file in the repo for version control, but have the CI/CD pipeline copy it into the Cloudflare Worker's deployment bundle (or into a Cloudflare KV/R2 bucket) on every push. The Worker reads from KV at runtime — sub-millisecond, no GitHub API calls. |
| **GitHub API rate limits:** If the Worker fetches from GitHub's raw content API on every request, you'll hit 60 req/hr (unauthenticated) or 5,000 req/hr (token).                                                                     | Avoid runtime GitHub API calls entirely. Use the deploy-time copy pattern above.                                                                                                                                                                                                           |
| **No atomicity:** If you have multiple JSON files and update them in separate commits, clients might read an inconsistent state.                                                                                                      | Use a single `remote-config.json` file for all config capabilities. Atomic by nature.                                                                                                                                                                                                      |
| **Cache invalidation:** CDN/Worker caching may serve stale config after an update.                                                                                                                                                    | Use versioned cache keys or `stale-while-revalidate` with a short `max-age`.                                                                                                                                                                                                               |

**Recommended deploy-time flow:**

```
Push to main
  → GitHub Actions
    → Copy config/remote-config.json into Cloudflare KV (or bundle into Worker)
    → Deploy Worker via wrangler
    → (existing) Deploy web app to Cloudflare Pages
    → (existing) Trigger EAS build
```

This gives you GitHub as the editing interface and version history, but the Worker serves from Cloudflare KV (or an inlined import) with zero external dependencies at request time.

---

### Q2: Config Schema Design

**Recommendation: One combined file, multiple endpoints for different cache profiles.**

Use a single `remote-config.json` as the source of truth (atomic updates, single commit), but expose it through multiple API endpoints with different cache headers:

```json
{
  "$schema": "https://your-domain.com/schemas/remote-config-v2.json",
  "schema_version": 2,
  "config_version": 47,
  "updated_at": "2026-07-25T10:00:00Z",

  "announcements": [
    {
      "id": "ann_2026_07_feature_x",
      "title": "New Feature Available",
      "body": "We've added background playback. Enable it in Settings.",
      "priority": "info",
      "start_at": "2026-07-20T00:00:00Z",
      "end_at": "2026-08-20T23:59:59Z",
      "dismissible": true,
      "target": {
        "min_app_version": "1.2.0",
        "platforms": ["ios", "android"]
      }
    }
  ],

  "version_release": {
    "latest_version": "1.3.0",
    "update_type": "js_bundle",
    "download_url": null,
    "release_notes": "Bug fixes and performance improvements.",
    "min_required_version": "1.1.0",
    "force_update_below": "1.0.5",
    "snoozable": true,
    "snooze_hours": 24
  },

  "feature_flags": {
    "defaults": {
      "downloads": true,
      "background_playback": true,
      "experimental_mode": false,
      "specific_provider_X": true
    },
    "overrides": [
      {
        "flag": "specific_provider_X",
        "enabled": false,
        "reason": "Provider API outage",
        "conditions": {
          "regions": ["EU"],
          "app_version_range": { "min": "1.0.0", "max": "1.2.x" }
        }
      }
    ]
  },

  "app_killswitch": {
    "enabled": true,
    "message": null,
    "maintenance_window": null
  },

  "feedback": {
    "enabled": true,
    "max_attachments_mb": 5,
    "allowed_categories": ["playback", "download", "ui", "crash", "other"],
    "rate_limit_per_day": 5
  }
}
```

**Why one file?**

- Atomic updates (one commit = one consistent state).
- Single `config_version` integer makes change detection trivial (client compares stored version vs. fetched version).
- Simpler CI/CD (one file to validate, one to deploy).

**Why multiple endpoints?**

- Different cache requirements: killswitch needs `max-age=30`, announcements can tolerate `max-age=3600`.
- Reduces payload for frequent polls (killswitch check only needs the `app_killswitch` + `feature_flags` subset, ~200 bytes vs. full config).

**Suggested endpoints:**

| Endpoint                        | Contents                                | Cache-Control                              |
| ------------------------------- | --------------------------------------- | ------------------------------------------ |
| `GET /api/config`               | Full config                             | `max-age=300, stale-while-revalidate=60`   |
| `GET /api/config/critical`      | `app_killswitch` + `feature_flags` only | `max-age=30, stale-while-revalidate=10`    |
| `GET /api/config/announcements` | Announcements array only                | `max-age=1800, stale-while-revalidate=300` |

---

### Q3: Caching Strategy

**Tiered caching approach:**

```
┌────────────────────────────────────────────────────────────┐
│ Tier 1: Killswitch / Feature Flags (CRITICAL)              │
│   Cache-Control: max-age=30, stale-while-revalidate=10     │
│   Client poll: every 60s while in foreground               │
│   Rationale: Must propagate within ~1-2 minutes            │
├────────────────────────────────────────────────────────────┤
│ Tier 2: Version Release                                    │
│   Cache-Control: max-age=300, stale-while-revalidate=60    │
│   Client poll: on app foreground + every 6 hours           │
│   Rationale: Updates are infrequent; 5-min staleness OK    │
├────────────────────────────────────────────────────────────┤
│ Tier 3: Announcements                                      │
│   Cache-Control: max-age=1800, stale-while-revalidate=300  │
│   Client poll: on app foreground + every 6 hours           │
│   Rationale: Content changes rarely; 30-min staleness OK   │
├────────────────────────────────────────────────────────────┤
│ Tier 4: Feedback metadata (categories, rate limits)        │
│   Cache-Control: max-age=86400                             │
│   Client poll: on app foreground                           │
│   Rationale: Almost never changes                          │
└────────────────────────────────────────────────────────────┘
```

**Client-side caching with react-query:**

```typescript
// Pseudocode for the critical config query
useQuery({
  queryKey: ["config", "critical"],
  queryFn: () => fetchConfig("/api/config/critical"),
  staleTime: 30_000, // Consider fresh for 30s
  gcTime: 5 * 60_000, // Keep in memory for 5 min
  refetchInterval: 60_000, // Poll every 60s
  refetchOnWindowFocus: true, // Refetch on app foreground (AppState)
  placeholderData: (prev) => prev, // Show stale data while fetching
});
```

**Cloudflare Worker caching:**
Use Cloudflare's Cache API within the Worker to cache the KV read for the duration of `max-age`. This means even with 10,000 concurrent mobile clients polling every 30s, the KV read happens once per 30s per colo.

---

### Q4: Config Change Propagation

**Recommended propagation mechanism:**

| Trigger                              | What it does                                                                                    | Latency   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | --------- |
| **App foreground (AppState change)** | Fetch `/api/config/critical` immediately                                                        | ~1-2s     |
| **Periodic foreground poll**         | Fetch `/api/config/critical` every 60s                                                          | ≤60s      |
| **Periodic background poll**         | Fetch full `/api/config` every 6h (via `expo-background-task` or react-query `refetchInterval`) | ≤6h       |
| **Push notification (optional)**     | Expo Push API sends a silent/data push with `{ "type": "config_update", "version": 48 }`        | ~5-15s    |
| **Manual pull-to-refresh**           | User-initiated full config refresh                                                              | Immediate |

**Change detection:**
The client stores `config_version` (integer) in AsyncStorage. On each fetch, compare the response's `config_version` to the stored value. If different, update local state and re-evaluate all config-dependent UI.

**For the killswitch specifically:**
The 60-second foreground poll on `/api/config/critical` (with `max-age=30` on the server) means worst-case propagation is ~90 seconds from GitHub push → CI deploy → client poll. For most killswitch scenarios (provider outage, legal takedown), this is acceptable.

If you need sub-10-second propagation, see Q5.

---

## 4.2 Feature Killswitch

### Q5: Real-Time Killswitch

**Options ranked by complexity:**

| Approach                                                                       | Latency | Complexity | New Dependencies                                          |
| ------------------------------------------------------------------------------ | ------- | ---------- | --------------------------------------------------------- |
| **(A) Aggressive foreground polling** (every 30-60s on `/api/config/critical`) | 30-90s  | Low        | None                                                      |
| **(B) Expo Push API data-only notification**                                   | 5-15s   | Medium     | Expo Push API (already available with expo-notifications) |
| **(C) Server-Sent Events (SSE) / WebSocket**                                   | <1s     | High       | Persistent connection management in RN                    |
| **(D) Firebase Cloud Messaging data message**                                  | 2-5s    | Medium     | Firebase (you want to avoid)                              |

**Recommendation: (A) + (B) hybrid.**

You already have `expo-notifications` configured. Expo's Push API supports **data-only notifications** (no visible alert, just a payload delivered to the app). When you push a killswitch change:

1. CI/CD deploys the updated config to Cloudflare KV.
2. CI/CD (or a manual trigger) calls the Expo Push API to send a data-only push to all registered tokens:
   ```json
   {
     "to": "ExponentPushToken[...]",
     "data": { "type": "config_invalidation", "config_version": 48 },
     "sound": null,
     "badge": null
   }
   ```
3. The mobile app's notification handler receives the data payload, triggers an immediate config refetch.

**This requires no new dependencies.** Expo Push API is part of the Expo ecosystem you're already using. You just need to:

- Register for push tokens on app start (you likely already do this for local notifications).
- Store tokens server-side (a simple D1 table or KV list).
- Add a CI step or admin endpoint that broadcasts the data push.

**Fallback:** If the push is delayed or fails (device offline, notification permissions denied), the 60-second foreground poll catches it.

**Important caveat:** Data-only pushes on iOS require the app to have background refresh enabled and may be throttled by Apple. Android is more reliable. The polling fallback is essential.

---

### Q6: Granular Control (Per-User / Per-Region Flags)

**Recommendation: Server-side evaluation with client hints.**

```
Client sends:  GET /api/config/critical?app_version=1.2.3&platform=android&region=EU&device_id=abc123
Server returns: Only the flags applicable to THIS client (already evaluated)
```

**Why server-side evaluation?**

- The config file stays simple (declarative rules).
- The client doesn't need complex rule-evaluation logic.
- You can change targeting rules without an app update.
- Reduces payload (client only gets relevant flags).

**Implementation in the Worker:**

```typescript
// Pseudocode for the Worker's flag evaluation
function evaluateFlags(config, clientContext) {
  const result = { ...config.feature_flags.defaults };

  for (const override of config.feature_flags.overrides) {
    if (matchesConditions(override.conditions, clientContext)) {
      result[override.flag] = override.enabled;
    }
  }

  return result;
}

function matchesConditions(conditions, ctx) {
  if (conditions.regions && !conditions.regions.includes(ctx.region))
    return false;
  if (
    conditions.app_version_range &&
    !semverInRange(ctx.app_version, conditions.app_version_range)
  )
    return false;
  if (conditions.device_ids && !conditions.device_ids.includes(ctx.device_id))
    return false;
  return true;
}
```

**Client context headers:**
The mobile app sends these as query params or headers on every config request:

- `X-App-Version: 1.2.3`
- `X-Platform: android`
- `X-Region: EU` (derived from device locale or IP geolocation at the Worker)
- `X-Device-ID: <anonymous-uuid>`

**For the "disable for specific user" case:**
Add a `device_ids` array to the override conditions. Since you're generating anonymous device UUIDs (see Q9), you can target specific devices.

**Privacy note:** The device ID is a random UUID, not tied to personal identity. Region can be derived from Cloudflare's `CF-IPCountry` header (free, no client involvement). Avoid sending precise location.

---

## 4.3 User Feedback System

### Q7: Data Storage

**Recommendation: (B) Cloudflare D1.**

Here's the detailed trade-off analysis:

| Criterion                  | (A) GitHub JSON                                                   | (B) Cloudflare D1                             | (C) Supabase/Firebase            |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------------- | -------------------------------- |
| **Write concurrency**      | ❌ GitHub API: 1 write/sec, race conditions on concurrent commits | ✅ SQLite with WAL, handles concurrent writes | ✅ Purpose-built for concurrency |
| **Query flexibility**      | ❌ Must load entire file, filter in JS                            | ✅ SQL queries, indexes, pagination           | ✅ Rich query API                |
| **Scalability**            | ❌ File grows unbounded, slow reads at 1000+ submissions          | ✅ Handles 100K+ rows easily                  | ✅ Virtually unlimited           |
| **Latency**                | ❌ GitHub API: 200-500ms per read/write                           | ✅ <5ms (same Cloudflare network as Worker)   | ⚠️ 50-200ms (external service)   |
| **New dependency**         | ✅ None                                                           | ⚠️ D1 (but already on Cloudflare)             | ❌ New vendor, new SDK           |
| **Cost**                   | ✅ Free                                                           | ✅ Free tier: 5M reads/day, 100K writes/day   | ⚠️ Free tier limits              |
| **Admin tooling**          | ✅ GitHub UI for viewing                                          | ⚠️ Need admin UI or `wrangler d1` CLI         | ✅ Built-in dashboard            |
| **Backup/versioning**      | ✅ Git history                                                    | ⚠️ Manual D1 exports                          | ⚠️ Vendor-managed                |
| **Integration complexity** | ⚠️ GitHub API auth, rate limits                                   | ✅ Native Worker binding (`env.DB`)           | ⚠️ New SDK, auth setup           |

**Why D1 wins for your case:**

1. You're **already on Cloudflare**. D1 is a native binding in Workers — zero network hop, zero new vendor.
2. The feedback system is **write-heavy** (users submit) and **query-heavy** (admin reviews, user checks status). A database is the correct primitive.
3. D1's free tier (5M row reads/day, 100K writes/day) will handle thousands of daily feedback submissions without cost.
4. It eliminates the GitHub API rate-limit problem entirely for writes.

**Schema for D1:**

```sql
CREATE TABLE feedback_submissions (
  id TEXT PRIMARY KEY,              -- 'feedback_' + nanoid
  device_id TEXT NOT NULL,          -- anonymous device UUID
  type TEXT NOT NULL CHECK(type IN ('bug_report', 'feature_request')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'resolved', 'closed')),
  app_version TEXT,
  platform TEXT,
  device_info TEXT,                 -- JSON: OS version, model, etc.
  attachment_url TEXT,              -- R2 URL if screenshot uploaded
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE feedback_replies (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES feedback_submissions(id),
  author TEXT NOT NULL DEFAULT 'dev_team',
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE push_tokens (
  device_id TEXT PRIMARY KEY,
  expo_push_token TEXT NOT NULL,
  platform TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_submissions_device ON feedback_submissions(device_id);
CREATE INDEX idx_submissions_status ON feedback_submissions(status);
CREATE INDEX idx_replies_submission ON feedback_replies(submission_id);
```

**For attachments (screenshots):**
Use **Cloudflare R2** (also already in your Cloudflare account). The Worker generates a presigned upload URL, the client uploads directly to R2, and the submission stores the R2 object key. No base64 in the database.

---

### Q8: Reply Notification

**Recommendation: (C) In-app badge on foreground + (B) Expo Push API for background notification.**

**The hybrid approach:**

1. **Foreground (primary):** When the app comes to foreground, it calls `GET /api/feedback?device_id=X&has_new_replies=true`. If there are unread replies, show a badge on the feedback tab/icon and a local notification via `expo-notifications`.

2. **Background (best-effort):** When a developer posts a reply via the admin interface, the Worker:
   - Writes the reply to D1.
   - Looks up the device's Expo push token from the `push_tokens` table.
   - Calls the Expo Push API to send a notification:
     ```json
     {
       "to": "ExponentPushToken[xxx]",
       "title": "Reply to your feedback",
       "body": "The team responded to your bug report.",
       "data": { "type": "feedback_reply", "submission_id": "feedback_abc123" },
       "sound": "default",
       "badge": 1
     }
     ```

**Does this require Firebase?** No. Expo Push API handles the FCM/APNs communication for you. You just need:

- The `expo-notifications` package (already installed).
- To register for push tokens and send them to your backend.
- The backend calls `https://exp.host/--/api/v2/push/send` with the token.

**This is the simplest push notification setup for an Expo app.** No Firebase project, no APNs certificates to manage manually — Expo handles all of it.

**Implementation note:** You'll need to handle the case where the user hasn't granted notification permission. In that case, fall back to the in-app badge approach only.

---

### Q9: Anonymous User Identification

**Approach: UUID v4 stored in AsyncStorage (or expo-secure-store).**

```typescript
// On first app launch:
import { v4 as uuidv4 } from "uuid";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICE_ID_KEY = "anonymous_device_id";

async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `device_${uuidv4()}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
```

**Edge cases and mitigations:**

| Edge Case                                       | Impact                                                                       | Mitigation                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **App uninstall/reinstall**                     | Device ID is lost; user appears as new. Previous submissions are orphaned.   | Accept this. The feedback system is low-stakes. Alternatively, use `expo-secure-store` (survives app updates but NOT uninstalls on iOS; survives both on Android). |
| **Multiple devices**                            | Each device gets a unique ID. User can't see submissions from other devices. | Accept this for an anonymous system. If you later add optional accounts, you can merge.                                                                            |
| **AsyncStorage cleared (user clears app data)** | Same as uninstall.                                                           | Same mitigation.                                                                                                                                                   |
| **Device ID collision**                         | Astronomically unlikely with UUID v4 (2^122 space).                          | No action needed.                                                                                                                                                  |
| **User wants to "reset" their identity**        | They can clear app data.                                                     | Document this. No server-side action needed.                                                                                                                       |

**Is this sufficient?** Yes, for an anonymous feedback system. The device ID is not meant to be a secure identity — it's a correlation key. You're not protecting sensitive data; you're just routing replies to the right device.

**One enhancement:** Store the device ID in `expo-secure-store` instead of plain AsyncStorage. On Android, this uses the Keystore; on iOS, the Keychain. This prevents casual tampering (a user can't easily edit the ID to impersonate another device's submissions). It still won't survive an uninstall on iOS, but that's acceptable.

---

### Q10: Developer Interface

**Recommendation: A simple admin page in the Next.js app, protected by a shared secret.**

**Why not GitHub Issues?**

- GitHub Issues can't easily associate with anonymous device IDs.
- No built-in reply-to-user notification flow.
- Requires the team to context-switch to GitHub.

**Why not email?**

- Adds an email service dependency.
- Harder to track conversation threads.
- No structured status management.

**Recommended admin UI:**

A password-protected route in your Next.js app: `/admin/feedback`

```
/admin/feedback          → List all submissions (filterable by status, type, date)
/admin/feedback/:id      → View submission detail + reply thread + reply form
```

**Authentication:** A simple shared password stored as an environment variable, checked via a middleware or server-side session cookie. For a small team, this is sufficient. No need for OAuth or a full auth system.

```typescript
// apps/web/middleware.ts (simplified)
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/admin")) {
    const session = request.cookies.get("admin_session");
    if (!session || session.value !== process.env.ADMIN_SESSION_TOKEN) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }
}
```

**Admin capabilities:**

- View all submissions with filtering/sorting.
- Change submission status (open → in_progress → resolved).
- Post replies (which trigger the push notification flow from Q8).
- View device metadata (app version, platform, device info).
- Export submissions as CSV/JSON for offline analysis.

**Alternative for MVP:** If building the admin UI feels like too much upfront, you can use `wrangler d1 execute` to query submissions from the CLI, and build a minimal reply endpoint that you call via `curl` or a simple script. Upgrade to the UI later.

---

## 4.4 Implementation Strategy

### Q11: Phased Rollout

**Recommended phases:**

```
Phase 1 (Week 1-2): Remote Config Infrastructure
├── Design and finalize remote-config.json schema
├── Create the config file in the private GitHub repo
├── Add CI step to deploy config to Cloudflare KV on push
├── Create /api/config and /api/config/critical endpoints
├── Mobile: RemoteConfigProvider + react-query integration
├── Mobile: AsyncStorage offline fallback
└── Test: Edit JSON → push → verify mobile picks up change

Phase 2 (Week 2-3): Feature Flags & Killswitch
├── Implement flag evaluation logic in the Worker
├── Mobile: useFeatureFlag() hook
├── Mobile: App-level killswitch screen
├── Mobile: Feature-gated UI components
├── Add /api/config/critical with 30s cache
├── Mobile: 60s foreground polling for critical config
└── Test: Disable a feature → verify app hides it within 90s

Phase 3 (Week 3-4): Announcements & Version Notifications
├── Mobile: AnnouncementBanner component (dismissible, priority-styled)
├── Mobile: Dismissed announcements persisted in AsyncStorage
├── Mobile: Version check logic (compare local vs. remote version)
├── Mobile: Update prompt UI (integrate with existing UpdateOverlay)
├── Mobile: Snooze logic for version notifications
└── Test: Add announcement → verify display; dismiss → verify persistence

Phase 4 (Week 4-6): Feedback System
├── Set up Cloudflare D1 database + schema
├── Create feedback API endpoints (POST, GET)
├── Mobile: Feedback submission form (bug report + feature request)
├── Mobile: Anonymous device ID generation
├── Mobile: Feedback history view (list + detail + replies)
├── Mobile: Push token registration → backend
├── Admin: /admin/feedback page (list, detail, reply)
├── Admin: Reply → Expo Push notification trigger
├── Mobile: Reply notification handling (foreground + background)
└── Test: Full round-trip (submit → admin reply → user notified)

Phase 5 (Week 6-7): Polish & Hardening
├── Rate limiting on feedback submission endpoint
├── Config schema validation (reject invalid JSON in CI)
├── Error handling & offline mode testing
├── Analytics/logging for config fetch failures
├── Documentation for the team (how to edit config, how to use admin)
└── Load testing (simulate 10K concurrent config polls)
```

**Dependencies:**

- Phase 2, 3 depend on Phase 1 (config infrastructure).
- Phase 4 is independent of Phases 2-3 (different data store, different endpoints).
- Phase 5 depends on all prior phases.

**Why this order?**

- Phase 1 is the foundation; everything else builds on it.
- Phase 2 (killswitch) is the highest-value, lowest-effort capability after the foundation. It's also the most time-sensitive in production (you need it working before you ship features that might need killing).
- Phase 3 is user-facing but lower urgency.
- Phase 4 is the most complex (new database, admin UI, push notifications) and benefits from the patterns established in Phases 1-3.

---

### Q12: Integration with Existing State Management

**Recommendation: A dedicated `RemoteConfigProvider` (React Context) backed by react-query.**

```typescript
// Architecture:
//
// RemoteConfigProvider (Context)
//   └── useQuery('config') → fetches /api/config
//   └── useQuery('config-critical') → fetches /api/config/critical (60s poll)
//   └── Persists last-known-good config to AsyncStorage
//   └── Exposes: useRemoteConfig(), useFeatureFlag(), useAnnouncements()
//
// SettingsProvider (existing, unchanged)
//   └── User preferences (theme, download quality, etc.)
//   └── NOT for remote config — keep these separate
```

**Why a separate Context and not just react-query hooks directly?**

- The config affects the entire app tree (killswitch can disable the whole app).
- A Context provider at the root layout (`app/_layout.tsx`) can gate the entire app behind the killswitch.
- It provides a single place to handle the "config unavailable" fallback logic.
- Individual screens use `useFeatureFlag('downloads')` — a thin hook that reads from the context.

**Integration with existing patterns:**

```typescript
// app/_layout.tsx (modified)
export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <RemoteConfigProvider>   {/* NEW */}
          <AppGate>              {/* NEW: checks killswitch */}
            <Stack />
          </AppGate>
        </RemoteConfigProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}

// hooks/useFeatureFlag.ts
export function useFeatureFlag(flag: string): boolean {
  const { featureFlags } = useRemoteConfig();
  return featureFlags[flag] ?? false; // Default to disabled if unknown
}

// In a screen component:
function DownloadScreen() {
  const downloadsEnabled = useFeatureFlag('downloads');
  if (!downloadsEnabled) return <FeatureDisabledScreen />;
  return <DownloadUI />;
}
```

**react-query configuration for config:**

```typescript
// lib/remote-config/queries.ts
export const configQueryOptions = {
  queryKey: ["remote-config"],
  queryFn: fetchRemoteConfig,
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
  refetchOnMount: true,
  refetchOnReconnect: true,
  retry: 2,
  placeholderData: (previousData) => previousData ?? getCachedConfig(),
};

export const criticalConfigQueryOptions = {
  queryKey: ["remote-config", "critical"],
  queryFn: fetchCriticalConfig,
  staleTime: 30_000,
  refetchInterval: 60_000,
  refetchOnMount: true,
};
```

**AppState listener for foreground refetch:**

```typescript
// Inside RemoteConfigProvider
useEffect(() => {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      queryClient.invalidateQueries({ queryKey: ["remote-config"] });
    }
  });
  return () => subscription.remove();
}, []);
```

---

### Q13: Error Handling & Fallbacks

**Layered fallback strategy:**

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Network request succeeds                            │
│   → Use fresh config, update AsyncStorage cache              │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Network fails, cached config exists                 │
│   → Use AsyncStorage-cached config (last-known-good)         │
│   → Show subtle "offline" indicator if relevant              │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: Network fails, no cache (first launch offline)      │
│   → Use hardcoded defaults (compiled into the app)           │
│   → All features enabled, no announcements, no killswitch    │
│   → App functions normally in "default mode"                 │
└─────────────────────────────────────────────────────────────┘
```

**Critical principle: The app must never be bricked by a config fetch failure.** If the config API is unreachable, the app uses defaults and functions normally. The killswitch only activates when the config is _successfully fetched_ and says `app_enabled: false`.

**Schema versioning for backward compatibility:**

```json
{
  "schema_version": 2,
  "min_client_version": "1.0.0",
  ...
}
```

- The client checks `schema_version`. If it's higher than what the client understands, the client ignores unknown fields and uses defaults for them.
- The client checks `min_client_version`. If the client's version is below this, it knows the config may contain fields it can't parse — it should use conservative defaults.
- **Rule:** Never remove or rename fields. Only add new ones. Use the `schema_version` to signal breaking changes that require an app update.

**Validation in CI:**
Add a JSON Schema validation step in GitHub Actions that runs on every push to the config file:

```yaml
- name: Validate remote config
  run: npx ajv validate -s config/remote-config.schema.json -d config/remote-config.json
```

This prevents deploying a malformed config that could crash clients.

---

### Q14: Security Considerations

| Concern                              | Risk                                                                                  | Mitigation                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Config tampering (MITM)**          | Attacker modifies config in transit (e.g., enables all features, disables killswitch) | HTTPS (already enforced by Cloudflare). Optionally, sign the config with an HMAC and verify on the client.                                                        |
| **Config tampering (repo access)**   | Unauthorized person edits the GitHub JSON                                             | Private repo + branch protection + required PR reviews for config changes.                                                                                        |
| **Feedback spam/abuse**              | Bot submits thousands of feedback entries                                             | Rate limiting in the Worker (e.g., 5 submissions per device per day, tracked in D1). CAPTCHA is overkill for this.                                                |
| **Feedback injection**               | Malicious content in feedback text                                                    | Sanitize/escape on display in admin UI. Don't render HTML from user input.                                                                                        |
| **Device ID spoofing**               | User changes device ID to bypass rate limits or access others' submissions            | Use `expo-secure-store` (hardware-backed). Accept that a determined attacker can still reset. The feedback system is low-value; don't over-engineer.              |
| **Admin endpoint access**            | Unauthorized access to admin UI                                                       | Shared secret + HTTP-only cookie. IP allowlisting if the team has fixed IPs. For a small team, this is sufficient.                                                |
| **Push token leakage**               | Someone obtains a device's push token and sends spam notifications                    | Tokens are stored server-side in D1, not exposed to clients. The reply endpoint is admin-only.                                                                    |
| **Config reveals feature existence** | Competitors or curious users inspect the config and discover unreleased features      | The config is served over HTTPS to authenticated apps only (add a simple API key header). Alternatively, accept this — feature flags are not a security boundary. |

**Rate limiting implementation (Cloudflare Worker):**

```typescript
// Simple sliding-window rate limit using D1
async function checkRateLimit(
  deviceId: string,
  db: D1Database,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .prepare(
      "SELECT COUNT(*) as count FROM feedback_submissions WHERE device_id = ? AND created_at > ?",
    )
    .bind(deviceId, windowStart)
    .first();
  return count < 5; // Max 5 per day
}
```

---

## 4.5 Open Questions

### Q15: Things You Might Be Missing

**1. Config observability and debugging:**
Add a hidden "debug" screen in the app (accessible via a long-press or shake gesture) that shows:

- Current `config_version` and when it was last fetched.
- All active feature flags and their values.
- Active announcements.
- Whether the config was fetched from network or cache.
- The device ID.

This is invaluable for debugging "why is this feature disabled on my device?" during development and QA.

**2. Config change audit log:**
Since the config lives in GitHub, you get commit history for free. But consider adding a `changed_by` and `change_reason` field to the config metadata:

```json
{
  "meta": {
    "config_version": 47,
    "updated_at": "2026-07-25T10:00:00Z",
    "updated_by": "dev@yourteam.com",
    "change_reason": "Disabled provider_X due to API outage"
  }
}
```

This helps the team understand _why_ a flag was changed, especially during incidents.

**3. Graceful degradation of the killswitch:**
If you kill the entire app (`app_enabled: false`), ensure the user can still:

- See the maintenance message.
- Access their locally-stored data (downloads, settings).
- Contact support (the feedback system should still work even when the app is "disabled").

Don't make the killswitch a hard brick. Make it a "degraded mode."

**4. Testing the config pipeline:**
Create a `config/staging/remote-config.json` that's deployed to a staging environment. Test config changes in staging before pushing to production. Your CI can deploy to staging on PR merge and to production on tag/release.

**5. Feedback attachment handling:**
If users can attach screenshots:

- Use Cloudflare R2 for storage (free tier: 10GB storage, 10M reads/month).
- Generate presigned upload URLs in the Worker (avoids proxying large files through the Worker).
- Set a max file size (5MB) and validate MIME types server-side.
- Auto-delete attachments after 90 days (D1 cron trigger or scheduled Worker).

**6. Internationalization of announcements:**
If your app supports multiple languages, consider adding a `locale` field to announcements:

```json
{
  "id": "ann_001",
  "title": { "en": "New Feature!", "es": "¡Nueva función!" },
  "body": { "en": "...", "es": "..." }
}
```

The client selects the appropriate locale. If the locale is missing, fall back to `en`.

**7. Sunset old config versions:**
When you bump `schema_version`, older app versions may not understand the new schema. Plan for this:

- Keep the old schema fields alongside new ones for 2-3 release cycles.
- Use `min_client_version` to tell old clients "you need to update to parse this config."
- Eventually remove deprecated fields once adoption of the new app version is >95%.

**8. Don't couple the killswitch to app store review:**
The entire point of the killswitch is to avoid the app store review process. Ensure your killswitch logic is purely in the JS bundle (not native code), so it works with `expo-updates` JS bundle updates. If the killswitch itself is broken, you can push a JS fix via expo-updates without store review.

**9. Consider a "config fetch budget":**
On metered connections or in low-battery mode, reduce polling frequency. Respect Android's Doze mode and iOS's background refresh limitations. The 60-second foreground poll is fine, but don't add background polling that drains battery.

**10. Plan for config size growth:**
As you add more announcements, flags, and overrides, the config file grows. Set a soft limit (e.g., 50KB) and archive old announcements. The `/api/config/critical` endpoint should always remain tiny (<1KB) since it's polled frequently.

---

## Summary of Key Recommendations

| Decision                 | Recommendation                                      | Rationale                                             |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| Config source of truth   | JSON in private GitHub repo                         | Version history, familiar workflow                    |
| Config serving           | Cloudflare KV (populated by CI) → Worker            | Zero-latency reads, no GitHub API dependency          |
| Config schema            | Single file, multiple endpoints with different TTLs | Atomic updates + tiered freshness                     |
| Killswitch propagation   | 60s foreground poll + Expo data push                | <90s worst case, no new dependencies                  |
| Feature flag evaluation  | Server-side (Worker evaluates rules)                | Simple client, flexible targeting                     |
| Feedback storage         | Cloudflare D1                                       | Native to your stack, handles writes, free tier       |
| Feedback attachments     | Cloudflare R2                                       | Same vendor, presigned uploads                        |
| Reply notifications      | Expo Push API (data + alert)                        | Already in your stack, no Firebase needed             |
| Anonymous identity       | UUID v4 in expo-secure-store                        | Simple, sufficient, tamper-resistant                  |
| Admin interface          | Password-protected Next.js page                     | Minimal effort, integrated with existing app          |
| Mobile state             | RemoteConfigProvider (Context) + react-query        | Fits existing patterns, testable                      |
| Offline fallback         | AsyncStorage cache → hardcoded defaults             | App never bricks                                      |
| New third-party services | **None required**                                   | Everything achievable with GitHub + Cloudflare + Expo |

---

## Final Note

The architecture you've described is well-thought-out, and your instinct to minimize dependencies is correct. The only "new" infrastructure component is Cloudflare D1, which is a natural extension of your existing Cloudflare deployment rather than a true third-party dependency. Everything else leverages what you already have.

The most important thing to get right in Phase 1 is the **config deployment pipeline** (GitHub push → CI → KV update → Worker serves fresh config). Once that's solid and tested, the remaining capabilities are straightforward application logic on top of a reliable data-fetching layer.

Good luck with the implementation. Feel free to follow up on any specific aspect of this architecture.
