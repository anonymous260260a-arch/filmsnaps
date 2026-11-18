-- 005_dashboard_index.sql
--
-- Dashboard read-diet: the admin dashboard runs ~20 aggregate queries per
-- view, all filtering telemetry_events by (name, ts) and full-scanning the
-- table (~2M rows read per dashboard load on D1's free 5M/day read cap).
-- This composite index turns every one of them into a range scan that reads
-- only the matching rows.
--
-- Also serves the raw drill-down (mode=raw&event=...) and the cron's
-- retention DELETE (which filters on ts alone — index prefix still helps
-- name-scoped queries first).
--
-- One-time build cost: full table read (~121MB / ~3M rows). Safe to re-run:
-- IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_telemetry_name_ts ON telemetry_events (name, ts);
