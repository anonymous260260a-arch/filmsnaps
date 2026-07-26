# Expert Consultation: Remote Configuration & User Feedback System

> **Purpose of this document:** We are seeking expert guidance on architecting a
> remote configuration and user feedback system for a cross-platform mobile
> application. The goal is to determine the best architectural approach,
> technologies, and implementation strategy **before** any code is written.
>
> **This is a design/architecture consultation — not an implementation task.**

---

## 1. Application Context

### 1.1 Tech Stack Overview

The application is a **React Native mobile app built with Expo** (Expo SDK 55,
React Native 0.83.6, React 19.2.0). It uses **Expo Router** for navigation
(file-based routing under `app/`). The project is a **pnpm monorepo** with three
main apps and a shared package:

| Package           | Description                                                 |
| ----------------- | ----------------------------------------------------------- |
| `apps/mobile`     | The mobile app (React Native + Expo, Android & iOS)         |
| `apps/web`        | A Next.js 16 web app (deployed to Cloudflare Pages/Workers) |
| `apps/desktop`    | An Electron desktop app                                     |
| `packages/shared` | Shared TypeScript library ( state, security, theme)         |

The build system is **Turborepo**. Mobile builds are handled by **EAS (Expo
Application Services)**. CI/CD runs on **GitHub Actions**.

### 1.2 Key Existing Patterns

**Remote config (already in use):** The project already serves a JSON config
file (`blocklist.json`) through a Next.js API route (`GET /api/blocklist`).
The mobile app fetches this on startup to control ad-blocking behavior. The
config includes a `version` field that, when bumped, forces clients to refresh.
Cache headers are set to `max-age=3600` (1 hour).

**In-app updates (already in use):** The app uses `expo-updates` to check for
and apply JavaScript bundle updates on launch. A custom `UpdateOverlay`
component shows download progress and a "Restart to update" prompt. Updates are
published to Expo's update service (`https://u.expo.dev/...`).

**Notifications (already in use):** The app uses `expo-notifications` for local
notifications (e.g., download progress/completion). The notification handler is
configured in the download subsystem.

**State management:** `@tanstack/react-query` for server state with
`AsyncStorage` persistence. A custom `SettingsProvider` (React Context +
AsyncStorage) handles user preferences.

**Backend/API:** The web app's Next.js API routes are compiled to **Cloudflare
Workers** via OpenNext. The mobile app communicates with the web backend via
REST API calls .

**Deployment flow:** Pushing to `main` triggers GitHub Actions which builds and
deploys the web app to Cloudflare Pages/Workers and triggers EAS mobile builds.

### 1.3 What We Are NOT Asking About

- We are **not** asking about the app's core purpose or domain.
- We are **not** asking about the app's name, branding, or identity.
- We are **not** asking about existing features or the current codebase.
- We are **not** asking about sensitive data, credentials, or infrastructure
  secrets.

---

## 2. What We Want to Implement

We want to implement a **unified remote configuration and user feedback system**
that allows us to control the app's behavior and communicate with users by
updating a single source — ideally a JSON file in a private GitHub repository.
When we push a change to that file, the deployed web backend picks it up, and
mobile app clients fetch the updated config on their next session.

### 2.1 Capability 1: Announcements

**Goal:** Display in-app announcements to all users. An announcement might say
something like:

> "Example Announcement: We've added a new feature! Check out the updated
> settings page for details."

**Requirements:**

- Announcements should be fetched from the remote config source.
- They should be displayed in a non-intrusive banner or card within the app
  (e.g., on the home screen or in a dedicated "Announcements" section).
- Multiple announcements may be active simultaneously.
- Each announcement should have: a title, a body message, a start date, an end
  date (optional), and a priority level (e.g., "info", "warning", "urgent").
- Users should be able to dismiss individual announcements. Dismissed
  announcements should not reappear (persisted locally).
- The announcement list should be refreshed periodically (e.g., on app
  foreground, or every 6 hours).

**Example config shape (mock):**

```json
{
  "announcements": [
    {
      "id": "announcement_001",
      "title": "Example Announcement Title",
      "body": "This is an example announcement body text.",
      "priority": "info",
      "start_at": "2025-01-01T00:00:00Z",
      "end_at": "2025-12-31T23:59:59Z",
      "dismissible": true
    }
  ]
}
```

### 2.2 Capability 2: New Version Release Notifications

**Goal:** Notify users when a new version of the app is available, even if the
update is delivered via expo-updates (JS bundle) or via the app store (native
binary).

**Requirements:**

- The remote config should specify the latest version number (e.g.,
  `"latest_version": "1.2.3"`).
- If the client's current version is older than the latest version, show a
  notification or in-app prompt.
- The config should indicate the update type: `"js_bundle"` (seamless, via
  expo-updates) or `"app_store"` (requires store download).
- For `"app_store"` updates, provide a download URL or deep link to the store.
- For `"js_bundle"` updates, the existing `expo-updates` flow can handle the
  actual update; the config just needs to trigger the notification.
- Users should be able to snooze or dismiss the notification.

**Example config shape (mock):**

```json
{
  "version_release": {
    "latest_version": "1.2.3",
    "update_type": "js_bundle",
    "download_url": null,
    "message": "A new version is available with bug fixes and improvements.",
    "min_required_version": "1.0.0"
  }
}
```

### 2.3 Capability 3: Feature Killswitch / Remote Disable

**Goal:** Instantly disable or "kill" a specific feature or capability in the
app from the remote config, without requiring an app store update. This is
essentially a **feature flag** or **killswitch** mechanism.

**Requirements:**

- The config should support a list of feature flags, each with an enabled/
  disabled state.
- Example features to control: `"downloads"`, `"background_playback"`,
  `"experimental_mode"`, `"specific_provider_X"`.
- When a feature is disabled, the app should hide or block access to that
  feature's UI and prevent its functionality from executing.
- The change should take effect on the next app session (or ideally, in near
  real-time if the app is in the foreground).
- There should be a way to disable a feature for **all users** or for a
  **specific subset** (e.g., by user ID, region, or app version).
- The config should support a "kill switch" that can disable the entire app
  (e.g., `"app_enabled": false`) with an optional message explaining why.

**Example config shape (mock):**

```json
{
  "feature_flags": {
    "downloads": true,
    "background_playback": true,
    "experimental_mode": false,
    "specific_provider_X": true
  },
  "app_enabled": true,
  "app_disabled_message": "Maintenance in progress. Please check back soon."
}
```

### 2.4 Capability 4: User Feedback System (Bug Reports & Feature Requests)

**Goal:** Allow users to submit bug reports and feature requests directly from
within the app. The development team should receive these submissions and be
able to reply to users, with users receiving notifications when a reply is
posted.

**Requirements:**

- Users should be able to submit:
  - **Bug reports** (with optional screenshot, device info, app version, and
    a text description).
  - **Feature requests** (with a text description and optional category).
- Submissions should be stored somewhere the development team can review them.
- The development team should be able to **reply** to each submission.
- Users should receive a **notification** when a reply is posted to their
  submission.
- Users should be able to view the status of their submissions (e.g., "open",
  "in progress", "resolved") and see the reply thread.
- The system should not require users to create an account or log in.
  Instead, a unique anonymous user ID should be generated and stored locally
  (e.g., via AsyncStorage) so that replies can be associated with the correct
  device.

**Example submission shape (mock):**

```json
{
  "id": "feedback_abc123",
  "user_id": "device_9876543210",
  "type": "bug_report",
  "title": "Example Bug Report Title",
  "description": "Example bug description with steps to reproduce.",
  "category": "playback",
  "status": "open",
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-01-16T14:00:00Z",
  "replies": [
    {
      "id": "reply_001",
      "author": "dev_team",
      "message": "Example reply: We're looking into this issue.",
      "created_at": "2025-01-16T14:00:00Z"
    }
  ]
}
```

---

## 3. Current Infrastructure Constraints & Preferences

### 3.1 Source of Truth

We want the **primary source of truth** to be a JSON file (or set of JSON files)
in a **private GitHub repository**. When we commit and push changes to this file,
the deployed backend should serve the updated config. The mobile app fetches
the config from the backend API.

**Why GitHub?** It provides version history, easy editing via the web UI, and
familiar workflows for the team.

### 3.2 Backend

The web app is deployed to **Cloudflare Pages/Workers** via OpenNext. The
existing `/api/blocklist` route already demonstrates the pattern of reading a
JSON file from the repo and serving it via a Next.js API route. We would likely
follow the same pattern for the new config endpoints.

### 3.3 Mobile Client

The mobile app is a standard Expo React Native app. It can make HTTP requests
to the backend API. It already uses `expo-notifications` for local
notifications and `expo-updates` for JS bundle updates.

### 3.4 No Additional Services (Preferred)

We would **prefer not to introduce** additional third-party services (e.g.,
Firebase Remote Config, LaunchDarkly, Sentry, Postmark, etc.) if the same
functionality can be achieved with the existing stack (GitHub + Cloudflare
Workers + expo-notifications). However, we are open to recommendations if a
third-party service would significantly simplify the implementation or provide
critical capabilities (e.g., push notifications for feedback replies).

### 3.5 Data Persistence

For the feedback system, we need a way to **persist user submissions and
replies**. Options include:

- A JSON file in the GitHub repo (simple, but not ideal for write-heavy
  operations and concurrent access).
- A database (e.g., Cloudflare D1, Supabase, etc.) — would require adding a
  new service.
- A third-party backend-as-a-service (e.g., Supabase, Firebase Firestore).

We are unsure which approach is best and would like expert guidance.

---

## 4. Questions for the Expert

### 4.1 Architecture & Data Flow

1. **Overall architecture:** What is the recommended architecture for a system
   that reads config from a GitHub-hosted JSON file, serves it via a Cloudflare
   Worker, and consumes it in a React Native Expo app? Are there any pitfalls
   with the "GitHub file → Cloudflare Worker API → mobile client" approach?

2. **Config schema design:** How should we design the JSON schema for the
   remote config to support all four capabilities (announcements, version
   releases, feature flags, and feedback system metadata) in a single file?
   Should we use one combined config file or separate files/endpoints for each
   capability?

3. **Caching strategy:** The existing `/api/blocklist` endpoint uses
   `Cache-Control: max-age=3600`. What caching strategy do you recommend for
   the new config endpoints? How do we balance freshness (e.g., killswitch
   needs to propagate quickly) with API cost and performance?

4. **Config change propagation:** When we push a change to the GitHub JSON
   file, how quickly should mobile clients pick up the change? What is the
   best mechanism for the mobile app to detect config changes — polling on app
   foreground, background fetch, or something else?

### 4.2 Feature Killswitch

5. **Real-time killswitch:** If we need to disable a feature immediately (e.g.,
   a provider is down), how can we ensure the mobile app picks up the change
   within seconds rather than waiting for the next app session? Is there a
   lightweight push mechanism we can use without introducing a full push
   notification service?

6. **Granular control:** How should we implement per-user or per-region
   feature flags? Should the mobile app send its user ID and region to the
   config API, or should the config be a flat list that the app filters
   locally?

### 4.3 User Feedback System

7. **Data storage:** For the feedback system, what is the best approach for
   storing submissions and replies? We are considering:
   - **(A)** A JSON file in the GitHub repo (read by the Worker for display,
     written via GitHub API on submission).
   - **(B)** A lightweight database (e.g., Cloudflare D1).
   - **(C)** A third-party BaaS (e.g., Supabase, Firebase Firestore).

   Which approach would you recommend, and why? What are the trade-offs?

8. **Reply notification:** How should users be notified when a developer
   replies to their feedback? Options include:
   - **(A)** Local polling: the app periodically checks for new replies.
   - **(B)** Push notifications: the backend sends a push notification when a
     reply is posted.
   - **(C)** In-app badge/alert: the app checks for unread replies on
     foreground.

   Given that the app already uses `expo-notifications`, is there a way to
   send push notifications without introducing Firebase? If not, what is the
   simplest push notification setup for an Expo app?

9. **Anonymous user identification:** We want users to be identified without
   requiring an account. We plan to generate a unique device ID and store it
   in AsyncStorage. Is this approach sufficient for associating replies with
   the correct device? What are the edge cases (e.g., app uninstall/reinstall,
   multiple devices)?

10. **Developer interface:** How should the development team review and reply
    to feedback submissions? Should we build a simple admin UI (e.g., a
    password-protected page in the Next.js app), or is there a simpler
    approach (e.g., GitHub issues, email notifications)?

### 4.4 Implementation Strategy

11. **Phased rollout:** How would you recommend phasing this implementation?
    Which capability should we build first, and what are the dependencies
    between them?

12. **Existing patterns:** The app already has a `SettingsProvider` (Context +
    AsyncStorage) and uses `@tanstack/react-query` for server state. How should
    the remote config be integrated into these existing patterns? Should the
    config be a new React Context, a react-query store, or something else?

13. **Error handling & fallbacks:** If the config API is unreachable (e.g.,
    network error, Cloudflare outage), what should the mobile app do? Should
    it use cached config, default values, or fail gracefully? How should we
    handle config schema versioning to avoid breaking older app versions?

14. **Security considerations:** What security concerns should we be aware of
    for each capability? For example:
    - How do we prevent unauthorized users from submitting feedback?
    - How do we prevent config tampering?
    - Should the feedback submission endpoint require any form of
      authentication or rate limiting?

### 4.5 Open Questions

15. **Anything we're missing:** Is there anything we haven't considered that
    is important for this system? Are there any best practices, common
    pitfalls, or alternative approaches we should know about?

---

## 5. Appendix: Relevant Code References

The following files demonstrate existing patterns in the codebase that are
relevant to this consultation:

| File                                                   | What it shows                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `apps/web/app/api/blocklist/route.ts`                  | Serving a JSON config file from the repo via a Next.js API route (the pattern we want to extend) |
| `apps/mobile/components/UpdateOverlay.tsx`             | In-app update UI using expo-updates                                                              |
| `apps/mobile/hooks/useUpdateCheck.ts`                  | The update checking logic                                                                        |
| `apps/mobile/lib/settings.tsx`                         | SettingsProvider pattern (Context + AsyncStorage)                                                |
| `apps/mobile/lib/download/notifications.ts`            | expo-notifications usage for local notifications                                                 |
| `apps/mobile/lib/api.ts`                               | How the mobile app determines the backend API base URL                                           |
| `apps/mobile/app/_layout.tsx`                          | Root layout showing provider composition                                                         |
| `apps/mobile/app/(tabs)/settings.tsx`                  | Settings page UI patterns                                                                        |
| `apps/mobile/android/app/src/main/AndroidManifest.xml` | Declared Android permissions                                                                     |
| `apps/mobile/app.json`                                 | Expo config including expo-updates and runtime version                                           |
| `eas.json`                                             | EAS build configuration (production profile with autoIncrement)                                  |
| `.github/workflows/cloudflare.yml`                     | CI/CD deployment to Cloudflare                                                                   |
| `.github/workflows/mobile.yml`                         | CI/CD mobile build via EAS                                                                       |
| `blocklist.json`                                       | The existing remote config file (served via /api/blocklist)                                      |
| `.env.example`                                         | Environment variable patterns (includes Firebase config placeholders)                            |

---

## 6. Summary of What We Need

We need an expert to review this document and provide:

1. **An architectural recommendation** for the overall system (data flow,
   components, and how they interact).
2. **A recommended JSON schema** for the remote config that supports all four
   capabilities.
3. **Specific technology recommendations** for the feedback system's data
   storage and reply notification mechanism.
4. **Implementation guidance** for integrating the config into the mobile app's
   existing state management patterns.
5. **Best practices and pitfalls** to avoid for each capability.
6. **A phased implementation plan** (which to build first, dependencies, etc.).

We are particularly interested in approaches that **minimize new third-party
dependencies** and leverage the existing stack (GitHub, Cloudflare Workers,
Expo, expo-notifications) as much as possible.
