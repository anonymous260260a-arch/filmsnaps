-- 004_version_ping.sql
-- Sampled per-request version accounting for API traffic.
--
-- worker.mjs samples ~1-in-10 /api/* requests (CRYPTO-random) and upserts a
-- row per (day, client, app_version, anon_id). Estimates:
--   requests      ~= SUM(requests)  * SAMPLE_ONE_IN
--   unique users  ~= COUNT(DISTINCT anon_id) * SAMPLE_ONE_IN  (per version)
-- Requests with no x-app-version header are recorded with app_version = ''
-- (the "old app" bucket). No IPs, no identifiers beyond the random
-- per-install UUID the client already uses for aggregate grouping.
--
-- Retention: the daily cron purges rows older than VERSION_PING_RETENTION_DAYS.

CREATE TABLE IF NOT EXISTS version_ping_sample (
  day         TEXT    NOT NULL,            -- UTC 'YYYY-MM-DD'
  client      TEXT    NOT NULL,            -- mobile-android | mobile-ios | desktop | web | ssr | unknown
  app_version TEXT    NOT NULL DEFAULT '', -- '' = header absent (pre-telemetry builds)
  anon_id     TEXT    NOT NULL DEFAULT '', -- '' = client id not yet minted / not sent
  requests    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,            -- epoch ms of last upsert
  PRIMARY KEY (day, client, app_version, anon_id)
);

CREATE INDEX IF NOT EXISTS idx_version_ping_day
  ON version_ping_sample (day);

-- Bump this when you change SAMPLE_ONE_IN in worker.mjs so historical
-- estimates can be rescaled correctly.
CREATE TABLE IF NOT EXISTS version_ping_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR REPLACE INTO version_ping_meta (key, value)
  VALUES ('sample_one_in', '10');
