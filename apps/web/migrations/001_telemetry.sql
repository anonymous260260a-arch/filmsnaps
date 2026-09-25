-- FilmSnaps telemetry (anonymous usage) — D1 schema
-- Wide/nullable rows: only whitelisted dim keys ever land in dims_json.

CREATE TABLE IF NOT EXISTS telemetry_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  ts                INTEGER NOT NULL,
  app_version       TEXT,
  connection_class  TEXT,
  device_tier       TEXT,
  dims_json         TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telemetry_name_ts ON telemetry_events(name, ts);
CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_events(ts);
CREATE INDEX IF NOT EXISTS idx_telemetry_provider ON telemetry_events(
  json_extract(dims_json, '$.providerId'),
  ts
);
CREATE INDEX IF NOT EXISTS idx_telemetry_media ON telemetry_events(
  json_extract(dims_json, '$.mediaType'),
  ts
);

-- Retention: 365 days (run periodically, e.g. cron or manual):
-- DELETE FROM telemetry_events WHERE ts < (unixepoch('now') - 365*86400) * 1000;
