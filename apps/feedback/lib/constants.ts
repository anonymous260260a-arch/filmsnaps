import type {
  Severity,
  RoadmapItem,
  ChangelogEntry,
  FaqCategory,
} from "./types";

// ── Labels ──

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  planned: "Planned",
  "in-progress": "In Progress",
  completed: "Completed",
  declined: "Declined",
};

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  feature: "Feature",
  fix: "Fix",
  improvement: "Improvement",
  security: "Security",
};

// ── Validation ──

export const MIN_TITLE_LENGTH = 10;
export const MIN_DESCRIPTION_LENGTH = 20;
export const SUBMISSION_COOLDOWN_MS = 30_000; // 30 seconds

// ── Seed Data ──

export const SEED_ROADMAP: RoadmapItem[] = [
  {
    id: "rm-1",
    title: "Android TV Support",
    description:
      "Native Android TV app with leanback UI for couch-friendly browsing and playback.",
    status: "in-progress",
    progress: 65,
    estimatedRelease: "Q3 2026",
    upvotes: 142,
    upvotedBy: [],
  },
  {
    id: "rm-2",
    title: "Download Manager v2",
    description:
      "Improved download engine with resume support, bandwidth throttling, and queue management.",
    status: "completed",
    progress: 100,
    estimatedRelease: "Q3 2026",
    upvotes: 98,
    upvotedBy: [],
  },
  {
    id: "rm-3",
    title: "iOS App Launch",
    description:
      "Full-featured iOS app using the same React Native codebase with native optimizations.",
    status: "planned",
    progress: 10,
    estimatedRelease: "Q4 2026",
    upvotes: 203,
    upvotedBy: [],
  },
  {
    id: "rm-5",
    title: "Continue Watching",
    description:
      "Pick up where you left off across devices with synced progress.",
    status: "completed",
    progress: 100,
    upvotes: 184,
    upvotedBy: [],
  },
];

export const SEED_CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.6",
    releaseDate: "2026-07-29",
    changes: [
      {
        type: "feature",
        description:
          "Feedback portal with Cloudflare Workers + D1 database production architecture",
      },
      {
        type: "feature",
        description:
          "14-layer abuse prevention: Turnstile CAPTCHA, 3-tier rate limiting, spam scoring",
      },
      {
        type: "feature",
        description: "Offline submission queue with auto-retry on reconnect",
      },
      {
        type: "improvement",
        description:
          "How Content Works transparency page with ad-blocking explainer",
      },
      {
        type: "improvement",
        description: "Theme color token migration across all screens",
      },
      {
        type: "fix",
        description:
          "Download engine fixes: live byte tracking for accurate pause/resume",
      },
      {
        type: "fix",
        description: "Feedback portal WebView integration",
      },
      {
        type: "fix",
        description: "Guide page improvements with safe navigation",
      },
      {
        type: "security",
        description:
          "IP SHA-256 hashing, CSP headers, anti-spam content quality detection",
      },
    ],
  },
  {
    version: "1.0.5",
    releaseDate: "2026-07-15",
    changes: [
      {
        type: "feature",
        description: "Content transparency page with ad-blocking explainer",
      },
      {
        type: "improvement",
        description: "Coach marks removal for cleaner first-run experience",
      },
      {
        type: "fix",
        description: "Various crash fixes and stability improvements",
      },
    ],
  },
  {
    version: "1.0.4",
    releaseDate: "2026-07-01",
    changes: [
      {
        type: "feature",
        description: "Download manager with pause/resume support",
      },
      { type: "feature", description: "Background download notifications" },
      {
        type: "improvement",
        description: "Optimized video player startup time",
      },
    ],
  },
  {
    version: "1.0.3",
    releaseDate: "2026-06-15",
    changes: [
      {
        type: "feature",
        description: "New home page layout with hero banners",
      },
      {
        type: "improvement",
        description: "Search now includes subtitle results",
      },
      {
        type: "fix",
        description: "Fixed subtitle sync issues on certain files",
      },
    ],
  },
  {
    version: "1.0.2",
    releaseDate: "2026-06-01",
    changes: [
      {
        type: "security",
        description: "Updated content delivery security measures",
      },
      {
        type: "feature",
        description: "Added experimental providers for more content sources",
      },
      { type: "fix", description: "Fixed playback issues on Android 14" },
    ],
  },
  {
    version: "1.0.1",
    releaseDate: "2026-05-15",
    changes: [
      { type: "improvement", description: "Reduced app size by 30%" },
      {
        type: "fix",
        description: "Fixed memory leak in long playback sessions",
      },
      { type: "feature", description: "Added download quality selector" },
    ],
  },
];

export const SEED_FAQ: FaqCategory[] = [
  {
    id: "faq-getting-started",
    name: "Getting Started",
    items: [
      {
        question: "What is FilmSnaps?",
        answer:
          "FilmSnaps is a free streaming app that lets you watch movies and TV shows on your mobile device. We aggregate content from various sources and provide a unified, ad-free viewing experience.",
      },
      {
        question: "Is FilmSnaps free?",
        answer:
          "Yes, FilmSnaps is completely free to use. There are no subscription fees, no hidden charges, and no premium tiers. We do not show any advertisements within the app.",
      },
      {
        question: "Do I need to create an account?",
        answer:
          "No account or registration is required. FilmSnaps does not collect any personal data. Simply download the app and start watching immediately.",
      },
    ],
  },
  {
    id: "faq-content",
    name: "Content & Sources",
    items: [
      {
        question: "Where does the content come from?",
        answer:
          "FilmSnaps aggregates content from multiple third-party streaming sources. We do not host any content ourselves. The app acts as a browser that helps you find and access publicly available streams.",
      },
      {
        question: "Why do some movies not play?",
        answer:
          "Occasionally a source may be unavailable due to maintenance, regional restrictions, or takedown requests. Try switching to a different source using the server picker in the player. Most content has multiple sources available.",
      },
      {
        question: "How do you block ads?",
        answer:
          "FilmSnaps uses a built-in ad-blocking engine that runs network-level filtering. It blocks requests to known ad servers, tracking domains, and pop-up scripts before they reach your device. This is similar to how Brave browser blocks ads — it happens at the network request level, not by hiding elements after they load.",
      },
    ],
  },
  {
    id: "faq-technical",
    name: "Technical Issues",
    items: [
      {
        question: "Why is the video buffering?",
        answer:
          "Buffering is usually caused by a slow internet connection or a congested source server. Try lowering the quality in the player settings, switching to a different source, or checking your internet speed. For the best experience, we recommend a connection of at least 5 Mbps for 720p and 10 Mbps for 1080p.",
      },
      {
        question: "Subtitles are out of sync. What can I do?",
        answer:
          "You can adjust subtitle sync directly in the player using the subtitle offset controls. If the issue persists across multiple files, try switching to a different source which may have properly synced subtitles.",
      },
      {
        question: "Can I download content to watch offline?",
        answer:
          "Yes, FilmSnaps supports downloading content for offline viewing. Look for the download button on movie and TV show detail pages. You can manage your downloads from the Downloads section in Settings.",
      },
    ],
  },
  {
    id: "faq-privacy",
    name: "Privacy & Legal",
    items: [
      {
        question: "What data does FilmSnaps collect?",
        answer:
          "FilmSnaps collects no personal data whatsoever. Watch history, bookmarks, and settings are stored locally on your device only. We have no analytics SDKs, no tracking pixels, and no telemetry. See our Privacy Policy for full details.",
      },
      {
        question: "Is streaming legal?",
        answer:
          "FilmSnaps is a tool for accessing publicly available streams. We do not host, upload, or distribute copyrighted content. Users are responsible for ensuring they comply with local laws regarding streaming content. See our Legal page for more information.",
      },
      {
        question: "How do you make money if everything is free?",
        answer:
          "FilmSnaps is an open-source project built by a small team passionate about making media accessible. We do not generate revenue from the app. If you find the app useful, sharing it with others is the best way to support us.",
      },
    ],
  },
  {
    id: "faq-ads",
    name: "Ad Blocking Technology",
    items: [
      {
        question:
          "How is FilmSnaps ad blocking different from other ad blockers?",
        answer:
          "FilmSnaps uses an engine-level ad blocker that intercepts network requests before they reach the WebView. Unlike browser extensions that modify page content after loading (which can be detected), our approach works at the network level — similar to how Brave browser's Shields feature works. This makes it much harder for sites to detect and bypass.",
      },
      {
        question: "Can the streaming sources detect my ad blocker?",
        answer:
          "Some sources attempt to detect ad blocking. Because FilmSnaps blocks ads at the network request level rather than modifying page content, it is significantly harder to detect than traditional ad blockers. However, no system is perfect, and some sources may still show anti-adblock messages. We continuously update our filters to stay ahead.",
      },
      {
        question: "Will I ever see any ads?",
        answer:
          "Our goal is zero ads. In practice, the ad blocker catches the vast majority of ad requests. You may occasionally see a blocked-element placeholder or a brief anti-adblock warning from a source. We are constantly improving our filters to minimize these occurrences.",
      },
    ],
  },
];
