-- ============================================================
-- FilmSnaps Feedback Portal — D1 Schema + Seed Data
-- Migration 001: Initial schema
-- ============================================================

-- ── Feedback (bugs + features unified) ──

CREATE TABLE IF NOT EXISTS feedback (
  id                   TEXT PRIMARY KEY,
  type                 TEXT NOT NULL CHECK(type IN ('bug', 'feature')),
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'planned', 'in-progress', 'completed', 'declined')),
  severity             TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low')),
  expected_behavior    TEXT,
  actual_behavior      TEXT,
  steps_to_reproduce   TEXT,
  device_info          TEXT,
  app_version          TEXT,
  platform             TEXT,
  current_page         TEXT,
  problem              TEXT,
  suggested_solution   TEXT,
  alternative_solutions TEXT,
  business_value       TEXT,
  screenshots          TEXT,          -- JSON array of R2 URLs
  visitor_id           TEXT,
  fingerprint          TEXT,
  ip_hash              TEXT,
  spam_score           REAL DEFAULT 0.0,
  duplicate_of         TEXT,
  honeypot_caught      INTEGER DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_type     ON feedback(type);
CREATE INDEX IF NOT EXISTS idx_feedback_status   ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created  ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_visitor  ON feedback(visitor_id);
CREATE INDEX IF NOT EXISTS idx_feedback_duplicate ON feedback(duplicate_of);

-- ── Votes ──

CREATE TABLE IF NOT EXISTS votes (
  id          TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL,
  visitor_id  TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('upvote', 'downvote')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(feedback_id, visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_feedback ON votes(feedback_id);
CREATE INDEX IF NOT EXISTS idx_votes_visitor  ON votes(visitor_id);

-- ── Roadmap ──

CREATE TABLE IF NOT EXISTS roadmap (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'in-progress', 'completed')),
  progress           INTEGER NOT NULL DEFAULT 0,
  estimated_release  TEXT,
  related_feedback_id TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Changelog ──

CREATE TABLE IF NOT EXISTS changelog (
  version      TEXT PRIMARY KEY,
  release_date TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS changelog_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL REFERENCES changelog(version),
  change_type TEXT NOT NULL CHECK(change_type IN ('feature', 'fix', 'improvement', 'security')),
  description TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_changelog_version ON changelog_changes(version);

-- ── FAQ ──

CREATE TABLE IF NOT EXISTS faq_categories (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS faq_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id TEXT NOT NULL REFERENCES faq_categories(id),
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_faq_category ON faq_items(category_id);

-- ── Rate Limits ──

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  counter      INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SEED DATA
-- ============================================================

-- ── Roadmap Seed ──

INSERT OR IGNORE INTO roadmap (id, title, description, status, progress, estimated_release) VALUES
  ('rm-1', 'Android TV Support', 'Native Android TV app with leanback UI for couch-friendly browsing and playback.', 'in-progress', 65, 'Q3 2026'),
  ('rm-2', 'Download Manager v2', 'Improved download engine with resume support, bandwidth throttling, and queue management.', 'in-progress', 40, 'Q3 2026'),
  ('rm-3', 'iOS App Launch', 'Full-featured iOS app using the same React Native codebase with native optimizations.', 'planned', 10, 'Q4 2026'),
  ('rm-4', 'Subtitle Editor', 'In-app subtitle editor with sync adjustment, styling, and custom upload support.', 'planned', 0, 'Q4 2026'),
  ('rm-5', 'Continue Watching', 'Pick up where you left off across devices with synced progress.', 'completed', 100, NULL),
  ('rm-6', 'Chromecast Support', 'Cast movies and shows to your TV with full playback controls.', 'completed', 100, NULL);

-- ── Changelog Seed ──

INSERT OR IGNORE INTO changelog (version, release_date) VALUES
  ('1.0.5', '2026-07-15'),
  ('1.0.4', '2026-07-01'),
  ('1.0.3', '2026-06-15'),
  ('1.0.2', '2026-06-01'),
  ('1.0.1', '2026-05-15');

INSERT OR IGNORE INTO changelog_changes (version, change_type, description) VALUES
  ('1.0.5', 'feature', 'Content transparency page with ad-blocking explainer'),
  ('1.0.5', 'improvement', 'Coach marks removal for cleaner first-run experience'),
  ('1.0.5', 'fix', 'Various crash fixes and stability improvements'),
  ('1.0.4', 'feature', 'Download manager with pause/resume support'),
  ('1.0.4', 'feature', 'Background download notifications'),
  ('1.0.4', 'improvement', 'Optimized video player startup time'),
  ('1.0.3', 'feature', 'New home page layout with hero banners'),
  ('1.0.3', 'improvement', 'Search now includes subtitle results'),
  ('1.0.3', 'fix', 'Fixed subtitle sync issues on certain files'),
  ('1.0.2', 'security', 'Updated content delivery security measures'),
  ('1.0.2', 'feature', 'Added experimental providers for more content sources'),
  ('1.0.2', 'fix', 'Fixed playback issues on Android 14'),
  ('1.0.1', 'improvement', 'Reduced app size by 30%'),
  ('1.0.1', 'fix', 'Fixed memory leak in long playback sessions'),
  ('1.0.1', 'feature', 'Added download quality selector');

-- ── FAQ Seed ──

INSERT OR IGNORE INTO faq_categories (id, name) VALUES
  ('faq-getting-started', 'Getting Started'),
  ('faq-content', 'Content & Sources'),
  ('faq-technical', 'Technical Issues'),
  ('faq-privacy', 'Privacy & Legal'),
  ('faq-ads', 'Ad Blocking Technology');

INSERT OR IGNORE INTO faq_items (category_id, question, answer) VALUES
  ('faq-getting-started', 'What is FilmSnaps?', 'FilmSnaps is a free streaming app that lets you watch movies and TV shows on your mobile device. We aggregate content from various sources and provide a unified, ad-free viewing experience.'),
  ('faq-getting-started', 'Is FilmSnaps free?', 'Yes, FilmSnaps is completely free to use. There are no subscription fees, no hidden charges, and no premium tiers. We do not show any advertisements within the app.'),
  ('faq-getting-started', 'Do I need to create an account?', 'No account or registration is required. FilmSnaps does not collect any personal data. Simply download the app and start watching immediately.'),
  ('faq-content', 'Where does the content come from?', 'FilmSnaps aggregates content from multiple third-party streaming sources. We do not host any content ourselves. The app acts as a browser that helps you find and access publicly available streams.'),
  ('faq-content', 'Why do some movies not play?', 'Occasionally a source may be unavailable due to maintenance, regional restrictions, or takedown requests. Try switching to a different source using the server picker in the player. Most content has multiple sources available.'),
  ('faq-content', 'How do you block ads?', 'FilmSnaps uses a built-in ad-blocking engine that runs network-level filtering. It blocks requests to known ad servers, tracking domains, and pop-up scripts before they reach your device. This is similar to how Brave browser blocks ads — it happens at the network request level, not by hiding elements after they load.'),
  ('faq-technical', 'Why is the video buffering?', 'Buffering is usually caused by a slow internet connection or a congested source server. Try lowering the quality in the player settings, switching to a different source, or checking your internet speed. For the best experience, we recommend a connection of at least 5 Mbps for 720p and 10 Mbps for 1080p.'),
  ('faq-technical', 'Subtitles are out of sync. What can I do?', 'You can adjust subtitle sync directly in the player using the subtitle offset controls. If the issue persists across multiple files, try switching to a different source which may have properly synced subtitles.'),
  ('faq-technical', 'Can I download content to watch offline?', 'Yes, FilmSnaps supports downloading content for offline viewing. Look for the download button on movie and TV show detail pages. You can manage your downloads from the Downloads section in Settings.'),
  ('faq-privacy', 'What data does FilmSnaps collect?', 'FilmSnaps collects no personal data whatsoever. Watch history, bookmarks, and settings are stored locally on your device only. We have no analytics SDKs, no tracking pixels, and no telemetry. See our Privacy Policy for full details.'),
  ('faq-privacy', 'Is streaming legal?', 'FilmSnaps is a tool for accessing publicly available streams. We do not host, upload, or distribute copyrighted content. Users are responsible for ensuring they comply with local laws regarding streaming content. See our Legal page for more information.'),
  ('faq-privacy', 'How do you make money if everything is free?', 'FilmSnaps is an open-source project built by a small team passionate about making media accessible. We do not generate revenue from the app. If you find the app useful, sharing it with others is the best way to support us.'),
  ('faq-ads', 'How is FilmSnaps ad blocking different from other ad blockers?', 'FilmSnaps uses an engine-level ad blocker that intercepts network requests before they reach the WebView. Unlike browser extensions that modify page content after loading (which can be detected), our approach works at the network level — similar to how Brave browser''s Shields feature works. This makes it much harder for sites to detect and bypass.'),
  ('faq-ads', 'Can the streaming sources detect my ad blocker?', 'Some sources attempt to detect ad blocking. Because FilmSnaps blocks ads at the network request level rather than modifying page content, it is significantly harder to detect than traditional ad blockers. However, no system is perfect, and some sources may still show anti-adblock messages. We continuously update our filters to stay ahead.'),
  ('faq-ads', 'Will I ever see any ads?', 'Our goal is zero ads. In practice, the ad blocker catches the vast majority of ad requests. You may occasionally see a blocked-element placeholder or a brief anti-adblock warning from a source. We are constantly improving our filters to minimize these occurrences.');
