# Production-Grade Mobile App: Complete Infrastructure & Operations Guide

> **Context:** You're building your first app. This document covers everything
> _around_ your app code — the systems, tools, and practices that separate a
> hobby project from a production product. Every recommendation here has a
> **free tier** sufficient for launch and early growth.

---

## Table of Contents

1. [The Big Picture: What "Production-Grade" Actually Means](#1)
2. [Error Tracking & Crash Reporting](#2)
3. [Performance Monitoring (APM)](#3)
4. [Analytics & User Behavior](#4)
5. [Structured Logging & Observability](#5)
6. [Remote Config & Feature Flags](#6)
7. [User Feedback & Support](#7)
8. [Push Notifications](#8)
9. [Security Hardening](#9)
10. [Privacy & Compliance](#10)
11. [CI/CD & Release Management](#11)
12. [Testing Infrastructure](#12)
13. [Uptime & API Monitoring](#13)
14. [Incident Response & Alerting](#14)
15. [A/B Testing & Experimentation](#15)
16. [Deep Linking & Attribution](#16)
17. [Accessibility](#17)
18. [Internationalization](#18)
19. [Offline Resilience](#19)
20. [Environment & Secret Management](#20)
21. [Documentation & Runbooks](#21)
22. [App Store Compliance](#22)
23. [Consolidated Free-Tier Stack](#23)
24. [Implementation Priority & Phased Plan](#24)

---

## 1. The Big Picture: What "Production-Grade" Actually Means

A production app is not just code that runs. It's a **system you can observe, control, debug, and recover** when things go wrong — and things _will_ go wrong.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PRODUCTION APP LAYERS                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 1: OBSERVE        → What is happening?                       │
│    • Error tracking (crashes, JS exceptions, API failures)          │
│    • Performance metrics (startup time, frame rate, API latency)    │
│    • User behavior analytics (screens visited, flows completed)     │
│    • Structured logs (debuggable trails)                            │
│                                                                     │
│  Layer 2: CONTROL        → Can I change behavior without a release? │
│    • Remote config (announcements, killswitch)                      │
│    • Feature flags (enable/disable per user/region/version)         │
│    • A/B testing (experiment with UI/flows)                         │
│    • OTA updates (expo-updates for JS bundle fixes)                 │
│                                                                     │
│  Layer 3: COMMUNICATE    → Can I reach users and hear from them?    │
│    • Push notifications (transactional + engagement)                │
│    • In-app announcements                                           │
│    • User feedback (bug reports, feature requests)                  │
│    • Update prompts (force/optional)                                │
│                                                                     │
│  Layer 4: PROTECT        → Is the app and its users safe?           │
│    • API security (auth, rate limiting, input validation)           │
│    • Data encryption (at rest, in transit)                          │
│    • Privacy compliance (GDPR, consent, data deletion)              │
│    • Abuse prevention (spam, scraping, tampering)                   │
│                                                                     │
│  Layer 5: DELIVER        → Can I ship reliably and recover fast?    │
│    • CI/CD (automated build, test, deploy)                          │
│    • Staged rollouts (canary → 10% → 100%)                         │
│    • Rollback capability (instant revert)                           │
│    • Incident response (detect → diagnose → fix → communicate)     │
│                                                                     │
│  Layer 6: SUPPORT        → Can I maintain this long-term?           │
│    • Documentation (architecture, runbooks, onboarding)             │
│    • Monitoring & alerting (know before users complain)             │
│    • Testing (unit, integration, E2E, visual)                       │
│    • Environment management (dev, staging, prod)                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

You currently have pieces of Layers 2 and 5. You need **all six layers** to be production-grade.

---

## 2. Error Tracking & Crash Reporting

### Why You Need It

Without this, you're blind. Users will encounter crashes, and they won't tell you. You need to know:

- **What** crashed (stack trace, error message)
- **Where** it crashed (which screen, which function)
- **When** it crashed (timestamp, frequency)
- **Who** it affected (device model, OS version, app version)
- **How often** it happens (is it 1 user or 10,000?)

### Recommendation: **Sentry** (Free Tier)

| What you get (free)      | Limit        |
| ------------------------ | ------------ |
| Error events             | 5,000/month  |
| Performance transactions | 10,000/month |
| Release tracking         | Unlimited    |
| Alert rules              | Unlimited    |
| Team members             | Unlimited    |
| Data retention           | 30 days      |

**Why Sentry over alternatives:**

- First-class React Native + Expo SDK (`sentry-expo`).
- Captures native crashes (Java/Kotlin on Android, ObjC/Swift on iOS) AND JS exceptions.
- Source map upload in CI → readable stack traces.
- Release health tracking (crash-free sessions %).
- Breadcrumbs (user actions leading up to the crash).
- Self-hostable if you outgrow the free tier.

### What to Collect

```typescript
// Initialize in app/_layout.tsx (root)
import * as Sentry from "sentry-expo";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enableInExpoDevelopment: false,
  debug: false,
  tracesSampleRate: 0.2, // 20% of transactions for performance
  enabled: !__DEV__, // Only in production builds

  // Attach context to every error
  beforeSend(event) {
    event.tags = {
      ...event.tags,
      app_version: Constants.expoConfig?.version,
      runtime_version: Constants.expoConfig?.runtimeVersion,
    };
    return event;
  },
});
```

**Automatic captures:**

- Unhandled JS exceptions
- Native crashes (ANR on Android, hard crashes on iOS)
- Promise rejections
- Navigation errors (Expo Router integration)

**Manual captures (add these):**

```typescript
// API errors
try {
  const res = await fetch(apiUrl);
  if (!res.ok) {
    Sentry.captureMessage(`API ${res.status}: ${apiUrl}`, {
      level: "warning",
      extra: { url: apiUrl, status: res.status, body: await res.text() },
    });
  }
} catch (err) {
  Sentry.captureException(err, {
    tags: { context: "api_call", endpoint: apiUrl },
  });
}

// Download failures
Sentry.captureException(error, {
  tags: { context: "download", provider: providerName },
  extra: { videoId, quality, fileSize },
});

// User-facing errors (non-crash)
Sentry.captureMessage("Payment flow abandoned at step 3", {
  level: "info",
  tags: { context: "ux_funnel" },
});
```

**Breadcrumbs (automatic user action trail):**

```typescript
// Sentry auto-captures these with the Expo SDK:
// - Navigation events (screen transitions)
// - Network requests (URL, status, duration)
// - Console logs
// - UI touches (if enabled)

// Add custom breadcrumbs:
Sentry.addBreadcrumb({
  category: "download",
  message: "User started download",
  data: { videoId: "123", quality: "1080p" },
  level: "info",
});
```

### Release Health Tracking

Sentry tracks **crash-free sessions** and **crash-free users** per release. This is your single most important health metric:

- **>99.5% crash-free sessions** → Healthy
- **99.0–99.5%** → Investigate
- **<99.0%** → Roll back or hotfix immediately

### Alerting Rules to Set Up

| Alert                    | Condition                       | Channel        |
| ------------------------ | ------------------------------- | -------------- |
| New crash type           | First occurrence of a new error | Email/Slack    |
| Crash spike              | >50 occurrences in 1 hour       | Email/Slack    |
| Crash-free rate drop     | <99% in 24h window              | Email (urgent) |
| API error rate           | >5% of requests failing         | Email/Slack    |
| ANR (App Not Responding) | Any occurrence                  | Email          |

---

## 3. Performance Monitoring (APM)

### Why You Need It

Users don't report "the app feels slow." They just uninstall. You need quantitative data on:

- **App startup time** (cold start, warm start)
- **Screen render time** (time to interactive per screen)
- **API latency** (p50, p95, p99 for each endpoint)
- **Frame rate** (dropped frames during scrolling/animations)
- **Memory usage** (leaks, high-water marks)
- **Battery/network impact** (background activity, data usage)

### Recommendation: **Sentry Performance** (included in free tier) + **Custom Metrics**

Sentry's performance monitoring gives you distributed tracing (10K transactions/month free). For mobile-specific metrics, add custom instrumentation.

### What to Track

```typescript
// 1. App Startup Time
import * as Sentry from "sentry-expo";

// In app/_layout.tsx, wrap the root component:
const startupTransaction = Sentry.startTransaction({
  name: "app_startup",
  op: "app.start",
});

// After first meaningful paint:
startupTransaction.finish();

// 2. Screen Load Time (Expo Router)
// Use navigation events:
const transaction = Sentry.startTransaction({
  name: `screen_${routeName}`,
  op: "navigation",
});
// Finish when data is loaded and rendered

// 3. API Latency (wrap your fetch layer)
async function trackedFetch(url: string, options?: RequestInit) {
  const span = Sentry.startSpan({
    name: `HTTP ${options?.method || "GET"} ${url}`,
    op: "http",
  });
  const start = performance.now();
  try {
    const res = await fetch(url, options);
    span.setHttpStatus(res.status);
    return res;
  } finally {
    span.setData("duration_ms", performance.now() - start);
    span.finish();
  }
}

// 4. Download Performance
Sentry.setMeasurement("download_speed_mbps", speedMbps);
Sentry.setMeasurement("download_duration_ms", durationMs);
Sentry.setMeasurement("file_size_mb", fileSizeMB);
```

### Key Performance Metrics to Dashboard

| Metric                            | Target                     | How to Measure               |
| --------------------------------- | -------------------------- | ---------------------------- |
| Cold start time                   | <2s (Android), <1.5s (iOS) | Sentry `app.start.cold`      |
| Warm start time                   | <1s                        | Sentry `app.start.warm`      |
| Time to Interactive (home screen) | <3s                        | Custom span                  |
| API p95 latency                   | <500ms                     | Sentry HTTP spans            |
| Scroll frame rate                 | >55 FPS                    | React Native Performance API |
| JS thread blocking                | <50ms per task             | Sentry ANR detection         |
| Memory (peak)                     | <300MB                     | Native module or Sentry      |
| App size (download)               | <50MB (APK/IPA)            | Build artifact size          |
| Bundle size (JS)                  | <5MB                       | Metro bundle analyzer        |

### React Native-Specific Performance

```typescript
// Frame rate monitoring (development + staging)
import { PerformanceObserver } from "react-native/Libraries/Performance/PerformanceObserver";

// Detect long JS tasks (potential UI jank)
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 50) {
      // >50ms = potential frame drop
      Sentry.addBreadcrumb({
        category: "performance",
        message: `Long task: ${entry.name} (${entry.duration}ms)`,
        level: "warning",
      });
    }
  }
});
observer.observe({ entryTypes: ["longtask"] });
```

---

## 4. Analytics & User Behavior

### Why You Need It

Error tracking tells you what's _broken_. Analytics tells you what's _used_, what's _confusing_, and where users _drop off_. You need to answer:

- Which screens are visited most/least?
- Where do users abandon a flow (funnel drop-off)?
- Which features are actually used vs. ignored?
- What's the retention curve (D1, D7, D30)?
- Are users completing key actions (download, play, share)?

### Recommendation: **PostHog** (Free Tier — 1M events/month)

| What you get (free)       | Limit                  |
| ------------------------- | ---------------------- |
| Event ingestion           | 1,000,000 events/month |
| Feature flags             | Unlimited              |
| A/B testing               | Unlimited              |
| Session replay            | 5,000 recordings/month |
| Funnels, retention, paths | Unlimited              |
| Team members              | Unlimited              |
| Data retention            | Unlimited              |
| Self-hosting option       | Yes (Docker)           |

**Why PostHog over Mixpanel/Amplitude:**

- Genuinely free at 1M events (Mixpanel free is 20M but locks features behind paid).
- Includes feature flags AND A/B testing AND session replay in one tool.
- Self-hostable (you own your data, no vendor lock-in).
- Open-source.
- React Native SDK is solid.
- Replaces 3 separate tools (analytics + feature flags + session replay).

### What to Track (Event Taxonomy)

**Design your events BEFORE you code them.** Use a consistent naming convention:

```
Format: <object>_<action>
Examples: screen_viewed, download_started, download_completed,
          playback_started, playback_error, feedback_submitted
```

**Essential events for any app:**

```typescript
import PostHog from "react-native-posthog";

// Initialize
const posthog = new PostHog(
  process.env.EXPO_PUBLIC_POSTHOG_KEY,
  { host: "https://app.posthog.com" }, // or self-hosted URL
);

// ─── App Lifecycle ───
posthog.capture("app_opened", {
  trigger: "cold_start" | "warm_start" | "notification" | "deep_link",
  app_version: "1.2.3",
});
posthog.capture("app_backgrounded");
posthog.capture("app_session_duration", { duration_seconds: 245 });

// ─── Navigation ───
posthog.capture("screen_viewed", {
  screen: "home" | "settings" | "download" | "player",
  referrer: "tab_bar" | "deep_link" | "notification",
});

// ─── Core Feature: Downloads ───
posthog.capture("download_started", {
  video_id: "abc123",
  quality: "1080p",
  file_size_mb: 45.2,
  provider: "provider_x",
});
posthog.capture("download_completed", {
  video_id: "abc123",
  duration_seconds: 32,
  speed_mbps: 12.5,
});
posthog.capture("download_failed", {
  video_id: "abc123",
  error_type: "network" | "provider" | "storage" | "unknown",
  error_message: "Connection timed out",
  progress_percent: 67,
});
posthog.capture("download_cancelled", {
  video_id: "abc123",
  progress_percent: 23,
  reason: "user_initiated",
});

// ─── Core Feature: Playback ───
posthog.capture("playback_started", {
  video_id: "abc123",
  source: "download" | "stream",
});
posthog.capture("playback_completed", {
  video_id: "abc123",
  watch_duration_seconds: 1200,
});
posthog.capture("playback_error", {
  video_id: "abc123",
  error_code: "CODEC_UNSUPPORTED",
});

// ─── Feature Flags / Killswitch ───
posthog.capture("feature_blocked", {
  feature: "downloads",
  reason: "killswitch",
});

// ─── User Feedback ───
posthog.capture("feedback_submitted", {
  type: "bug_report",
  category: "playback",
});
posthog.capture("feedback_reply_received", { submission_id: "feedback_abc" });

// ─── Errors (complement Sentry) ───
posthog.capture("error_occurred", {
  error_type: "api_timeout",
  endpoint: "/api/config",
  retry_count: 2,
  recovered: true,
});

// ─── Settings / Preferences ───
posthog.capture("setting_changed", {
  setting: "download_quality",
  old_value: "720p",
  new_value: "1080p",
});
```

### Funnels to Build in PostHog

```
Funnel 1: Download Completion
  screen_viewed (home) → download_started → download_completed
  Drop-off at each step = UX problem

Funnel 2: First Session Value
  app_opened (cold_start) → screen_viewed (any content) → download_started
  Measures: Does the user find value in their first session?

Funnel 3: Feedback Loop
  feedback_form_opened → feedback_submitted → feedback_reply_received
  Measures: Is the feedback system working end-to-end?
```

### Retention & Cohorts

PostHog automatically calculates:

- **D1/D7/D30 retention** (what % of users come back)
- **Feature adoption** (what % of users try feature X within 7 days)
- **Cohort analysis** (do users who download in week 1 retain better?)

### Session Replay (PostHog Free: 5,000/month)

This records the actual user screen interactions (anonymized). Invaluable for understanding UX issues:

- Where do users tap repeatedly (confusion)?
- Where do they scroll past content (not engaging)?
- Where do they rage-quit?

```typescript
// Enable session recording
posthog.startSessionRecording();

// Mask sensitive content (IMPORTANT for privacy)
// PostHog RN SDK masks text inputs by default
```

---

## 5. Structured Logging & Observability

### Why You Need It

Analytics tells you _what_ users do. Logs tell you _why_ the system did what it did. When debugging a production issue at 2 AM, you need a trail of events.

### Recommendation: **Cloudflare Workers Logs** (built-in, free) + **Sentry Breadcrumbs**

You don't need a separate logging service at your scale. Cloudflare Workers provides built-in logging via `console.log` visible in the dashboard and via `wrangler tail`. Sentry breadcrumbs capture client-side logs.

### Client-Side Logging Strategy

```typescript
// lib/logger.ts
import * as Sentry from "sentry-expo";

type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  log(level: LogLevel, message: string, data?: Record<string, any>) {
    const entry = {
      timestamp: new Date().toISOString(),
      context: this.context,
      level,
      message,
      ...data,
    };

    // In development: console output
    if (__DEV__) {
      console[level === "debug" ? "log" : level](
        `[${this.context}]`,
        message,
        data,
      );
    }

    // In production: Sentry breadcrumbs (last 100 stored, sent with errors)
    Sentry.addBreadcrumb({
      category: this.context,
      message,
      data,
      level: level === "debug" ? "debug" : level,
    });

    // Errors also go to Sentry as events
    if (level === "error") {
      Sentry.captureMessage(`[${this.context}] ${message}`, {
        level: "error",
        extra: data,
      });
    }
  }

  debug(msg: string, data?: any) {
    this.log("debug", msg, data);
  }
  info(msg: string, data?: any) {
    this.log("info", msg, data);
  }
  warn(msg: string, data?: any) {
    this.log("warn", msg, data);
  }
  error(msg: string, data?: any) {
    this.log("error", msg, data);
  }
}

// Usage:
const log = new Logger("download");
log.info("Download started", { videoId: "123", quality: "1080p" });
log.error("Download failed", {
  videoId: "123",
  error: err.message,
  progress: 67,
});
```

### Server-Side Logging (Cloudflare Workers)

```typescript
// In your API routes:
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  console.log(
    JSON.stringify({
      level: "info",
      requestId,
      method: "GET",
      path: "/api/config",
      userAgent: request.headers.get("user-agent"),
      country: request.cf?.country,
    }),
  );

  // ... handle request ...

  console.log(
    JSON.stringify({
      level: "info",
      requestId,
      status: 200,
      durationMs: Date.now() - start,
    }),
  );
}
```

View logs via:

- Cloudflare Dashboard → Workers → Logs (real-time)
- `wrangler tail` (CLI, real-time streaming)
- Logpush to an external destination (if you outgrow the dashboard)

---

## 6. Remote Config & Feature Flags

### Revised Recommendation: **PostHog Feature Flags** + **Self-Built Config on Cloudflare**

Since you're adding PostHog for analytics, use its **built-in feature flags** (free, unlimited) for the killswitch and feature toggles. This gives you:

- A visual UI to toggle flags (no JSON editing)
- Percentage rollouts (enable for 10% → 50% → 100%)
- User property targeting (by app version, platform, region)
- Instant propagation (PostHog SDK polls or you force-refresh)
- Audit trail (who changed what, when)

**Keep the self-built Cloudflare config for:**

- Announcements (content-heavy, changes infrequently)
- Version release metadata
- App-level killswitch message text

**Use PostHog for:**

- Feature flags (downloads, background_playback, experimental_mode)
- A/B tests
- Percentage rollouts

This hybrid gives you the best of both: PostHog's UI for flags, your own infra for content.

```typescript
// Feature flag check via PostHog
const downloadsEnabled = await posthog.isFeatureEnabled('downloads', {
  distinctId: deviceId,
  properties: {
    app_version: '1.2.3',
    platform: 'android',
    region: 'EU',
  },
});

// Killswitch via your own config (faster, no dependency on PostHog uptime)
const { app_killswitch } = await fetchCriticalConfig();
if (!app_killswitch.enabled) {
  return <MaintenanceScreen message={app_killswitch.message} />;
}
```

**Why keep the killswitch on your own infra?**
If PostHog has an outage, you still need to be able to kill your app. Your Cloudflare Worker + KV is under your control. The killswitch is your last resort — don't depend on a third party for it.

---

## 7. User Feedback & Support

### Recommendation: **Cloudflare D1** (as previously discussed) + **PostHog Surveys** (for quick NPS/feedback)

Use PostHog's built-in **Surveys** (free) for quick in-app feedback:

- "How was your download experience?" (1-5 stars)
- "What feature would you like next?" (text)
- NPS score periodically

Use your **D1-based feedback system** (from the previous consultation) for detailed bug reports with attachments and reply threads.

### Additional: In-App "Report a Problem" Shake Gesture

```typescript
// Trigger feedback form on device shake (react-native-shake or expo-sensors)
import { Accelerometer } from "expo-sensors";

// Detect shake → open feedback modal with pre-filled device info
```

---

## 8. Push Notifications

### Recommendation: **Expo Push API** (free, no Firebase needed)

As discussed previously. But here's the complete notification strategy:

| Notification Type     | Trigger                                | Priority |
| --------------------- | -------------------------------------- | -------- |
| Feedback reply        | Dev replies to user's bug report       | High     |
| Critical announcement | Urgent in-app announcement             | High     |
| Update available      | New version released                   | Default  |
| Download complete     | Background download finished           | Low      |
| Engagement (optional) | "You haven't opened the app in 7 days" | Low      |

**Token management:**

```typescript
// Register push token on app start
import * as Notifications from "expo-notifications";
import { registerForPushNotificationsAsync } from "./push-setup";

async function setupPush() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status === "granted") {
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    // Send token to your backend
    await fetch(`${API_BASE}/api/push/register`, {
      method: "POST",
      body: JSON.stringify({
        device_id: deviceId,
        token,
        platform: Platform.OS,
      }),
    });
  }
}
```

**Backend sending (Cloudflare Worker):**

```typescript
// POST /api/push/send (admin-only)
async function sendPush(token: string, title: string, body: string, data: any) {
  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: token,
      title,
      body,
      data,
      sound: "default",
      channelId: "default",
    }),
  });
}
```

---

## 9. Security Hardening

### 9.1 API Security

```
┌─────────────────────────────────────────────────────────────┐
│                    API SECURITY LAYERS                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. HTTPS ONLY (enforced by Cloudflare, non-negotiable)     │
│                                                             │
│  2. API KEY / APP ATTESTATION                               │
│     • Embed an API key in the app (obfuscated, not secret)  │
│     • Validate on every request via header                  │
│     • NOT real security — just prevents casual abuse        │
│                                                             │
│  3. RATE LIMITING (Cloudflare Worker)                       │
│     • Per-IP: 100 req/min for config endpoints              │
│     • Per-device: 5 feedback submissions/day                │
│     • Per-IP: 1000 req/min global                           │
│                                                             │
│  4. INPUT VALIDATION                                        │
│     • Validate all request bodies against JSON Schema       │
│     • Sanitize text inputs (strip HTML, limit length)       │
│     • Reject unexpected fields                              │
│                                                             │
│  5. CORS / ORIGIN RESTRICTION                               │
│     • Restrict API access to your app's user-agent          │
│     • (Not real security, but reduces noise)                │
│                                                             │
│  6. REQUEST SIGNING (for sensitive endpoints)               │
│     • HMAC signature of request body + timestamp            │
│     • Prevents replay attacks                               │
│     • Key embedded in app (obfuscated)                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Client-Side Security

```typescript
// 1. Certificate Pinning (prevent MITM)
// In app.json / app.config.js:
{
  "plugins": [
    ["expo-network", {
      "android": {
        "certificatePinning": {
          "your-api-domain.com": ["sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]
        }
      }
    }]
  ]
}

// 2. Jailbreak/Root Detection
import { isRooted } from 'react-native-device-info'; // or expo equivalent
// Don't block the app, but flag suspicious activity in Sentry

// 3. Sensitive Data Storage
// Use expo-secure-store (Keychain/Keystore), NEVER AsyncStorage for:
// - Device IDs
// - Push tokens
// - Any user-generated content that's private

// 4. Code Obfuscation
// Enable Hermes (default in RN 0.83+) — compiles JS to bytecode
// In app.json:
{
  "expo": {
    "android": { "enableHermes": true },
    "ios": { "enableHermes": true }
  }
}

// 5. Environment Variables
// NEVER hardcode secrets. Use EXPO_PUBLIC_ prefix for client vars.
// Server secrets stay in Cloudflare Worker env vars (wrangler.toml)
```

### 9.3 Data Security

| Data                    | Storage           | Encryption                             |
| ----------------------- | ----------------- | -------------------------------------- |
| User feedback text      | Cloudflare D1     | Encrypted at rest (Cloudflare default) |
| Screenshots/attachments | Cloudflare R2     | Encrypted at rest (AES-256)            |
| Device ID               | expo-secure-store | Hardware-backed (Keychain/Keystore)    |
| Push tokens             | Cloudflare D1     | Encrypted at rest                      |
| Config JSON             | Cloudflare KV     | Encrypted at rest                      |
| Analytics events        | PostHog cloud     | Encrypted in transit + at rest         |
| Error reports           | Sentry cloud      | Encrypted in transit + at rest         |

---

## 10. Privacy & Compliance

### 10.1 What You MUST Do (Legal Requirements)

Even for a free app, you must comply with:

- **GDPR** (EU users): Right to access, delete, and port their data.
- **CCPA** (California): Right to opt out of data "sale" (analytics may count).
- **Apple Privacy Nutrition Labels**: Declare all data you collect.
- **Google Play Data Safety**: Same as above for Android.

### 10.2 Consent Management

```typescript
// First-launch consent flow (before ANY tracking initializes)
// Required for EU users, recommended for all

const CONSENT_KEY = "user_consent_v1";

interface ConsentState {
  analytics: boolean; // PostHog, usage tracking
  crashReporting: boolean; // Sentry
  notifications: boolean; // Push notifications
  version: number;
  timestamp: string;
}

// Show a consent screen on first launch:
// "We collect anonymous usage data to improve the app. [Accept All] [Essential Only]"
//
// "Essential Only" = crash reporting only (legitimate interest under GDPR)
// "Accept All" = analytics + crash reporting + notifications
```

### 10.3 Data Minimization

**Only collect what you need. Specifically:**

| Collect                              | Don't Collect                     |
| ------------------------------------ | --------------------------------- |
| Anonymous device ID (UUID)           | Real name, email (no accounts)    |
| App version, OS version              | Precise GPS location              |
| Screen names visited                 | Keystrokes, input text            |
| Error stack traces                   | Contacts, photos, files           |
| Feature usage (which buttons tapped) | Browsing history outside your app |
| Device model (for debugging)         | Advertising ID (IDFA/GAID)        |

### 10.4 Data Deletion

```typescript
// User can request data deletion (GDPR Article 17)
// Provide in Settings: "Delete My Data"
// This calls your API:
//   DELETE /api/user-data?device_id=xxx
// Which deletes:
//   - All feedback submissions for that device_id (D1)
//   - Push token (D1)
//   - Analytics: PostHog has a delete API
//   - Sentry: Data auto-expires after 30 days
```

### 10.5 Privacy Policy

You need a privacy policy. Host it at `https://your-domain.com/privacy`. It must state:

- What data you collect
- Why you collect it
- Where it's stored
- How long you keep it
- How users can request deletion
- Third parties who receive data (Sentry, PostHog, Cloudflare)

Use a free generator (e.g., Termly, iubenda free tier) as a starting point, then customize.

---

## 11. CI/CD & Release Management

### Your Current Setup (Good Foundation)

```
Push to main → GitHub Actions → Deploy web (Cloudflare) + Build mobile (EAS)
```

### What to Add for Production

```yaml
# .github/workflows/mobile.yml (enhanced)
name: Mobile CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # ─── Gate: Run on every PR ───
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter mobile lint
      - run: pnpm --filter mobile typecheck
      - run: pnpm --filter mobile test -- --ci --coverage
      - run: pnpm --filter shared test

  # ─── Build: Only on main ───
  build:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile

      # Validate remote config schema
      - run: npx ajv validate -s config/schema.json -d config/remote-config.json

      # Deploy config to Cloudflare KV
      - run: npx wrangler kv key put remote-config "$(cat config/remote-config.json)" --binding=CONFIG_KV
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

      # Deploy web app
      - run: pnpm --filter web build
      - run: npx wrangler pages deploy

      # Build mobile (EAS)
      - run: npx eas build --platform all --profile production --non-interactive
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}

      # Upload source maps to Sentry
      - run: npx sentry-expo upload-sourcemaps
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: your-org
          SENTRY_PROJECT: your-app

  # ─── OTA Update: JS-only changes ───
  ota-update:
    needs: test
    if: github.ref == 'refs/heads/main' && contains(github.event.head_commit.message, '[ota]')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx eas update --branch production --message "${{ github.event.head_commit.message }}"
```

### Staged Rollouts

**For app store updates (native binary):**

- Google Play: Use staged rollout (10% → 50% → 100%) in the Play Console.
- Apple: Use phased release (automatic 7-day rollout) in App Store Connect.

**For OTA updates (JS bundle via expo-updates):**

- Expo supports rollout percentages:
  ```bash
  eas update --branch production --rollout-percentage 10
  # Monitor Sentry crash-free rate for 24h
  # If healthy:
  eas update --branch production --rollout-percentage 100
  ```

### Rollback Strategy

| Scenario                | Rollback Method                             | Time to Effect |
| ----------------------- | ------------------------------------------- | -------------- |
| Bad OTA update          | `eas update:republish` with previous bundle | Minutes        |
| Bad app store release   | Halt staged rollout, submit fix             | Hours (review) |
| Bad config change       | `git revert` + push (CI redeploys KV)       | <2 minutes     |
| Feature causing crashes | Toggle PostHog feature flag OFF             | Seconds        |
| Total app failure       | Activate killswitch in config               | <90 seconds    |

---

## 12. Testing Infrastructure

### What You Need

| Type                   | Tool                              | What It Catches           | Free?        |
| ---------------------- | --------------------------------- | ------------------------- | ------------ |
| **Unit tests**         | Jest (built into Expo)            | Logic errors, edge cases  | ✅           |
| **Component tests**    | React Native Testing Library      | UI logic, interactions    | ✅           |
| **E2E tests**          | Maestro (free, open-source)       | Full user flows           | ✅           |
| **Visual regression**  | Storybook + Chromatic (free tier) | UI changes                | ✅ (limited) |
| **Type checking**      | TypeScript `tsc --noEmit`         | Type errors               | ✅           |
| **Linting**            | ESLint + Prettier                 | Code quality, consistency | ✅           |
| **API contract tests** | Custom (validate response schema) | Backend breaking changes  | ✅           |

### Minimum Viable Test Suite

```
apps/mobile/
├── __tests__/
│   ├── unit/
│   │   ├── remote-config.test.ts      ← Config parsing, flag evaluation
│   │   ├── version-compare.test.ts    ← Semver comparison logic
│   │   ├── feedback-validation.test.ts ← Input validation
│   │   └── download-queue.test.ts     ← Download state machine
│   ├── components/
│   │   ├── AnnouncementBanner.test.tsx
│   │   ├── FeatureGate.test.tsx
│   │   └── FeedbackForm.test.tsx
│   └── e2e/
│       ├── app-launch.yaml            ← Maestro: app opens, no crash
│       ├── download-flow.yaml         ← Maestro: start → complete download
│       └── feedback-flow.yaml         ← Maestro: submit feedback
```

### Maestro E2E Example (Free, No Cloud Needed)

```yaml
# e2e/app-launch.yaml
appId: com.yourapp.mobile
---
- launchApp
- assertVisible: "Home"
- assertNotVisible: "Maintenance" # Killswitch is off
- tapOn: "Settings"
- assertVisible: "Settings"
- back
```

Run locally: `maestro test e2e/`
Run in CI: Add to GitHub Actions (runs on emulator).

---

## 13. Uptime & API Monitoring

### Recommendation: **UptimeRobot** (Free: 50 monitors, 5-min checks) + **Better Stack** (Free: 10 monitors, 30s checks)

Monitor these endpoints:

| Endpoint                     | Check Interval | Alert If         |
| ---------------------------- | -------------- | ---------------- |
| `GET /api/config`            | 1 min          | Down for >2 min  |
| `GET /api/config/critical`   | 1 min          | Down for >1 min  |
| `GET /api/blocklist`         | 5 min          | Down for >5 min  |
| `POST /api/feedback`         | 5 min          | Down for >5 min  |
| `GET /api/feedback/:test_id` | 5 min          | Down for >5 min  |
| Web app homepage             | 5 min          | Down for >5 min  |
| Expo update server           | 15 min         | Down for >15 min |

**Alert channels:** Email (free), Slack webhook (free), or SMS (Better Stack free: 10 SMS/month).

### Cloudflare-Specific Monitoring

Cloudflare provides built-in analytics:

- Request count, error rate, latency percentiles
- Worker CPU time, memory usage
- D1 query count, read/write units
- KV read/write operations

Set up **Cloudflare Notifications** (free) for:

- Worker error rate > 5%
- D1 approaching free tier limits
- Unusual traffic spike (potential DDoS)

---

## 14. Incident Response & Alerting

### Alert Severity Levels

| Severity          | Example                                                  | Response Time | Channel             |
| ----------------- | -------------------------------------------------------- | ------------- | ------------------- |
| **P0 - Critical** | App killswitch activated, >5% crash rate, API fully down | <15 min       | SMS + Email + Slack |
| **P1 - High**     | Single feature broken, >1% crash rate, API degraded      | <1 hour       | Email + Slack       |
| **P2 - Medium**   | Non-critical bug, slow API, minor UI issue               | <24 hours     | Email               |
| **P3 - Low**      | Cosmetic issue, minor analytics gap                      | Next sprint   | Slack               |

### Incident Response Runbook (Write This Down)

```markdown
## P0: App Killswitch Activated

1. CONFIRM: Check /api/config/critical → is app_enabled=false?
2. ASSESS: Check Sentry → crash-free rate, new errors in last 1h
3. DECIDE:
   - If config error → git revert config, push, wait for CI (<2 min)
   - If app bug → activate killswitch (if not already), prepare OTA fix
   - If external dependency down → keep killswitch, monitor, communicate
4. FIX: Push fix via OTA (eas update) or config revert
5. VERIFY: Check Sentry crash-free rate recovering
6. COMMUNICATE: Post announcement when resolved
7. POSTMORTEM: Write up within 48h (what, why, fix, prevention)
```

### Sentry Alert Rules (Configure These)

```
Rule 1: "New Fatal Error"
  → First occurrence of error with level=fatal
  → Notify: Email immediately

Rule 2: "Crash Spike"
  → >100 events in 1 hour for same error
  → Notify: Email immediately

Rule 3: "Crash-Free Rate Drop"
  → Crash-free sessions < 99% over 24h
  → Notify: Email immediately

Rule 4: "API Error Rate"
  → >5% of transactions have status >= 500
  → Notify: Email within 5 min

Rule 5: "Release Regression"
  → New release has >2x error rate vs. previous release
  → Notify: Email immediately
```

---

## 15. A/B Testing & Experimentation

### Recommendation: **PostHog A/B Testing** (included free)

You already have PostHog for analytics. Its A/B testing is built-in:

```typescript
// In your app:
const variant = await posthog.getFeatureFlag('download_button_color', {
  distinctId: deviceId,
});

// variant = 'control' | 'variant_a' | 'variant_b'
// Render accordingly:
<Button color={variant === 'variant_a' ? 'green' : 'blue'} />

// Track the outcome:
posthog.capture('download_started', {
  $feature_flag: 'download_button_color',
  $feature_flag_variant: variant,
});
```

PostHog calculates statistical significance automatically.

**Use A/B testing for:**

- Onboarding flow variations
- UI layout experiments
- Feature placement
- Notification copy

**Don't A/B test:**

- Core functionality (downloads, playback)
- Anything that could degrade UX for the "losing" variant
- Things with legal/compliance implications

---

## 16. Deep Linking & Attribution

### Why You Need It

- **Deep links:** Open the app to a specific screen from a URL (e.g., `yourapp://video/123`).
- **Universal Links (iOS) / App Links (Android):** Open from `https://your-domain.com/video/123`.
- **Attribution:** Know where users came from (Play Store, App Store, shared link).

### Implementation

```typescript
// app.json
{
  "expo": {
    "scheme": "yourapp",  // yourapp://
    "plugins": [
      ["expo-linking", {
        "android": { "intentFilters": [...] },
        "ios": { "associatedDomains": ["applinks:your-domain.com"] }
      }]
    ]
  }
}

// Expo Router handles deep links automatically via file-based routing:
// yourapp://video/123 → app/video/[id].tsx
// https://your-domain.com/video/123 → app/video/[id].tsx (with Universal Links)
```

**For attribution (where did the user come from):**

- PostHog captures `$referring_domain` and UTM parameters automatically.
- For app store attribution, use the free **Expo Attribution** (built into expo-updates).

---

## 17. Accessibility

### Why This Matters

- **Legal requirement** in many jurisdictions (ADA, EAA 2025 in EU).
- **App Store rejection risk** if accessibility is egregiously bad.
- **15-20% of users** have some form of disability.

### Minimum Requirements

```typescript
// 1. All interactive elements have accessible labels
<TouchableOpacity
  accessible={true}
  accessibilityLabel="Download video"
  accessibilityRole="button"
  accessibilityHint="Starts downloading the video in 1080p quality"
>
  <DownloadIcon />
</TouchableOpacity>

// 2. Sufficient color contrast (4.5:1 for text, 3:1 for large text)
// Use: https://webaim.org/resources/contrastchecker/

// 3. Minimum touch target: 44x44 points (iOS) / 48x48 dp (Android)

// 4. Screen reader support
// Test with: VoiceOver (iOS), TalkBack (Android)

// 5. Respect system font scaling
// Don't set fixed font sizes; use relative units or allow scaling

// 6. Don't convey information by color alone
// Use icons + text, not just red/green indicators

// 7. Support reduced motion
import { useReducedMotion } from 'react-native-reanimated';
const reduceMotion = useReducedMotion();
// Skip animations if reduceMotion is true
```

### Testing

- Run `npx react-native-accessibility-audit` (community tool).
- Manually test with VoiceOver/TalkBack on key flows.
- Use Android's Accessibility Scanner app.

---

## 18. Internationalization (i18n)

### Minimum for Launch

Even if you launch in English only, **set up i18n infrastructure now**. Retrofitting is 10x harder.

### Recommendation: **i18next + react-i18next** (free, standard)

```typescript
// lib/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";

import en from "./locales/en.json";
// import es from './locales/es.json'; // Add later

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: Localization.getLocales()[0]?.languageCode || "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
```

```json
// lib/i18n/locales/en.json
{
  "home": {
    "title": "Home",
    "download_button": "Download",
    "downloading": "Downloading... {{progress}}%"
  },
  "settings": {
    "title": "Settings",
    "quality": "Download Quality",
    "notifications": "Notifications"
  },
  "feedback": {
    "title": "Report a Problem",
    "submit": "Submit",
    "thank_you": "Thank you for your feedback!"
  }
}
```

**Rule:** Never hardcode user-facing strings. Always use `t('key')`.

---

## 19. Offline Resilience

### Strategy

| Scenario                         | Behavior                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| No internet on launch            | Use cached config from AsyncStorage. App works with last-known settings. |
| Config fetch fails               | Use cached config. Show no error (silent degradation).                   |
| Feedback submission fails        | Queue locally. Retry on next foreground. Show "will send when online."   |
| Download interrupted             | Resume from last byte (HTTP Range requests).                             |
| API returns 5xx                  | Retry with exponential backoff (1s, 2s, 4s, max 3 retries).              |
| App update available but offline | Skip update. Check again next launch.                                    |

```typescript
// Offline-first feedback submission
import NetInfo from "@react-native-community/netinfo";

async function submitFeedback(data: FeedbackData) {
  const isConnected = await NetInfo.fetch().then((s) => s.isConnected);

  if (!isConnected) {
    // Queue for later
    const queue = await getQueuedFeedback();
    queue.push({ ...data, queued_at: new Date().toISOString() });
    await saveQueuedFeedback(queue);
    showToast("Saved. Will submit when you're online.");
    return;
  }

  try {
    await fetch(`${API_BASE}/api/feedback`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch {
    // Network error mid-request: queue it
    // ... same as above
  }
}

// On app foreground: flush the queue
useEffect(() => {
  const sub = AppState.addEventListener("change", async (state) => {
    if (state === "active") await flushFeedbackQueue();
  });
  return () => sub.remove();
}, []);
```

---

## 20. Environment & Secret Management

### Environments

| Environment     | Purpose               | Config Source                | API URL                   |
| --------------- | --------------------- | ---------------------------- | ------------------------- |
| **Development** | Local dev, hot reload | Local `.env`                 | `localhost:3000`          |
| **Staging**     | Pre-release testing   | `config/staging/` in repo    | `staging.your-domain.com` |
| **Production**  | Live users            | `config/production/` in repo | `api.your-domain.com`     |

### Secret Management

```
NEVER commit secrets to git. Use:

Client-side (mobile app):
  → EXPO_PUBLIC_ prefixed vars in .env (NOT truly secret, just obfuscated)
  → For real secrets: proxy through your backend

Server-side (Cloudflare Workers):
  → wrangler secret put <KEY> (encrypted, stored in Cloudflare)
  → Or: Cloudflare Workers secrets in wrangler.toml (encrypted)

CI/CD (GitHub Actions):
  → GitHub encrypted secrets (Settings → Secrets)
  → EXPO_TOKEN, CLOUDFLARE_API_TOKEN, SENTRY_AUTH_TOKEN, etc.
```

### .env.example (commit this, NOT .env)

```bash
# Client (mobile)
EXPO_PUBLIC_API_BASE_URL=https://api.your-domain.com
EXPO_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
EXPO_PUBLIC_POSTHOG_KEY=phc_xxx
EXPO_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# Server (Cloudflare Workers) — set via wrangler secret
# CLOUDFLARE_API_TOKEN=xxx
# ADMIN_SESSION_SECRET=xxx
# GITHUB_CONFIG_TOKEN=xxx
```

---

## 21. Documentation & Runbooks

### What to Document (Write This Before You Forget)

```
docs/
├── ARCHITECTURE.md          ← System diagram, data flow, component roles
├── CONFIG_GUIDE.md          ← How to edit remote-config.json, what each field does
├── DEPLOYMENT.md            ← How to deploy (web, mobile, OTA, config)
├── INCIDENT_RESPONSE.md     ← What to do when things break (runbooks)
├── FEEDBACK_ADMIN.md        ← How to use the admin panel, reply to users
├── FEATURE_FLAGS.md         ← How to add/toggle flags, rollout process
├── SECRETS.md               ← Where secrets live, how to rotate them
├── ONBOARDING.md            ← New developer setup guide
└── CHANGELOG.md             ← What changed in each release
```

### Architecture Decision Records (ADRs)

For every major decision, write a short ADR:

```markdown
# ADR-001: Use Cloudflare D1 for Feedback Storage

## Status: Accepted

## Date: 2026-07-25

## Context

We need persistent storage for user feedback submissions and replies.
Options considered: GitHub JSON, Cloudflare D1, Supabase.

## Decision

Use Cloudflare D1 because: [reasons]

## Consequences

- Pro: No new vendor, native Worker integration, free tier sufficient
- Con: No built-in admin UI (must build our own)
- Con: SQLite limitations (no full-text search without extension)
```

---

## 22. App Store Compliance

### Apple App Store Requirements

| Requirement               | Action                                                                  |
| ------------------------- | ----------------------------------------------------------------------- |
| Privacy Nutrition Label   | Declare all data collected in App Store Connect                         |
| App Tracking Transparency | If you use IDFA (you don't), show ATT prompt. You can skip this.        |
| Sign in with Apple        | Only if you offer third-party login (you don't have accounts, so N/A)   |
| Data deletion             | Provide a way to delete user data (your "Delete My Data" button)        |
| Minimum functionality     | App must provide value beyond a website wrapper                         |
| Content moderation        | If users submit content (feedback text), you need a reporting mechanism |

### Google Play Requirements

| Requirement               | Action                                            |
| ------------------------- | ------------------------------------------------- |
| Data Safety form          | Declare all data collected in Play Console        |
| Privacy policy URL        | Must be accessible in-app and on store listing    |
| Permissions justification | Only request permissions you actually use         |
| Target API level          | Must target latest Android API (currently API 35) |
| 64-bit support            | Required (Expo handles this)                      |

### Pre-Submission Checklist

```
□ Privacy policy is live and accessible in-app
□ Data Safety / Privacy Nutrition Label is filled out accurately
□ All permissions have a clear justification
□ App doesn't crash on launch (test on 3+ devices)
□ Killswitch is tested and working
□ Feedback system is tested end-to-end
□ Analytics consent is shown before tracking starts
□ App works offline (doesn't crash without internet)
□ All store screenshots are current
□ App description mentions key features accurately
□ Content rating is appropriate
□ Export compliance is declared (if using encryption)
```

---

## 23. Consolidated Free-Tier Stack

Here's your complete production stack, all free:

| Category                    | Tool                       | Free Tier                                  | What It Does                                |
| --------------------------- | -------------------------- | ------------------------------------------ | ------------------------------------------- |
| **Source Control**          | GitHub                     | Unlimited private repos, 2000 CI min/month | Code hosting, PRs, CI/CD                    |
| **Web Hosting / API**       | Cloudflare Pages + Workers | 100K requests/day, unlimited bandwidth     | Backend API, web app                        |
| **Database**                | Cloudflare D1              | 5M reads/day, 100K writes/day, 5GB         | Feedback storage                            |
| **Object Storage**          | Cloudflare R2              | 10GB storage, 10M reads/month              | Screenshots, attachments                    |
| **Key-Value Store**         | Cloudflare KV              | 100K reads/day, 1K writes/day              | Remote config cache                         |
| **Error Tracking**          | Sentry                     | 5K errors/month, 10K transactions          | Crashes, errors, performance                |
| **Analytics + Flags + A/B** | PostHog                    | 1M events/month, unlimited flags           | Usage analytics, feature flags, experiments |
| **Push Notifications**      | Expo Push API              | Unlimited (Expo free tier)                 | Transactional + engagement pushes           |
| **OTA Updates**             | expo-updates               | Unlimited (Expo free tier)                 | JS bundle updates without store review      |
| **Mobile Builds**           | EAS Build                  | 30 builds/month (free)                     | Android + iOS builds                        |
| **CI/CD**                   | GitHub Actions             | 2000 min/month (private repos)             | Automated test, build, deploy               |
| **Uptime Monitoring**       | UptimeRobot                | 50 monitors, 5-min interval                | API/web uptime                              |
| **Logging**                 | Cloudflare Workers Logs    | Included with Workers                      | Server-side request logs                    |
| **i18n**                    | i18next                    | Open source, free                          | Multi-language support                      |
| **Testing**                 | Jest + Maestro             | Open source, free                          | Unit + E2E tests                            |
| **Accessibility**           | Built-in RN APIs           | Free                                       | Screen reader, contrast                     |
| **Crash Reporting**         | Sentry (same as above)     | Included                                   | Native + JS crashes                         |
| **Session Replay**          | PostHog (same as above)    | 5K recordings/month                        | UX debugging                                |

**Total monthly cost: $0** (until you exceed free tiers, which won't happen until you have tens of thousands of daily active users).

---

## 24. Implementation Priority & Phased Plan

### Phase 0: Before You Write Any Feature Code (Week 1)

```
□ Set up Sentry (install sentry-expo, create project, configure DSN)
□ Set up PostHog (create project, install SDK, configure keys)
□ Set up i18n infrastructure (i18next, en.json, t() wrapper)
□ Set up structured logger (lib/logger.ts)
□ Set up environment management (.env, .env.example, env validation)
□ Set up ESLint + Prettier + TypeScript strict mode
□ Write ARCHITECTURE.md
□ Create staging environment (staging.your-domain.com)
```

**Why first?** If you add observability after building features, you'll miss data from day 1. Instrument from the start.

### Phase 1: Core Infrastructure (Week 2-3)

```
□ Remote config system (Cloudflare KV + Worker endpoints)
□ RemoteConfigProvider (React Context + react-query)
□ Feature flags (PostHog)
□ Killswitch (self-built on Cloudflare, independent of PostHog)
□ CI/CD pipeline (test → build → deploy → upload source maps)
□ Config schema validation in CI
□ Uptime monitoring (UptimeRobot on all endpoints)
□ Sentry alert rules configured
```

### Phase 2: Observability (Week 3-4)

```
□ Sentry performance tracing (startup, navigation, API)
□ PostHog event taxonomy (all events defined and instrumented)
□ PostHog dashboards (retention, funnels, feature usage)
□ PostHog session recording enabled
□ Custom breadcrumbs for key user flows
□ Cloudflare Worker structured logging
□ Error boundaries in React (catch UI crashes → Sentry)
```

### Phase 3: User Communication (Week 4-5)

```
□ Announcements system (config-driven, dismissible)
□ Version update notifications (integrate with expo-updates)
□ Push notification infrastructure (token registration, Expo Push API)
□ In-app update overlay (already exists, enhance)
□ Consent management (first-launch consent screen)
```

### Phase 4: Feedback System (Week 5-7)

```
□ Cloudflare D1 setup + schema
□ Feedback API endpoints (submit, list, detail)
□ R2 for screenshot uploads
□ Mobile feedback form (bug report + feature request)
□ Anonymous device ID (expo-secure-store)
□ Admin panel (/admin/feedback in Next.js)
□ Reply → push notification flow
□ Feedback history view in app
□ Rate limiting
```

### Phase 5: Hardening & Compliance (Week 7-8)

```
□ Security audit (API key, rate limiting, input validation, cert pinning)
□ Privacy policy (write and host)
□ Data deletion endpoint
□ App Store compliance checklist
□ Accessibility audit (VoiceOver, TalkBack testing)
□ Offline resilience testing
□ E2E test suite (Maestro)
□ Incident response runbooks
□ Load testing (simulate 10K concurrent users)
□ Documentation finalization
```

### Phase 6: Launch & Iterate (Week 8+)

```
□ Staged rollout (10% → 50% → 100%)
□ Monitor Sentry crash-free rate (target: >99.5%)
□ Monitor PostHog retention (D1, D7)
□ Monitor API error rate (<1%)
□ Respond to feedback within 48h
□ Weekly review of Sentry + PostHog dashboards
□ Iterate based on data
```

---

## Final Advice for First-Time App Developers

1. **Instrument before you build.** You can't fix what you can't see. Sentry + PostHog from day 1.

2. **The killswitch is your best friend.** Ship features behind flags. If something breaks in production, flip the flag. Don't wait for an app store review.

3. **Your first release will have bugs.** That's fine. What matters is that you _know_ about them within minutes (Sentry), can _disable_ the broken feature within seconds (killswitch), and can _push a fix_ without store review (expo-updates).

4. **Don't build everything at once.** Launch with: error tracking, analytics, remote config, killswitch, and one feedback channel. Add the rest iteratively.

5. **Test on real devices.** Emulators lie. Test on at least one low-end Android device and one older iPhone. Performance issues hide on flagship devices.

6. **Monitor your free tier usage.** Set calendar reminders to check Sentry/PostHog/Cloudflare usage monthly. You don't want a surprise bill (or service cutoff) at 10K users.

7. **Write the runbook BEFORE the incident.** At 2 AM when your app is crashing for 50% of users, you don't want to be figuring out how to roll back for the first time.

8. **Privacy is not optional.** Even for a free app with no accounts, you collect data (analytics, crash reports, device info). Get consent. Have a privacy policy. Offer data deletion. This protects you legally and builds user trust.

---

This is your complete production operations blueprint. Every tool listed is free at launch scale. Every system described is something you'll thank yourself for having when (not if) something goes wrong in production. Good luck with your launch.
