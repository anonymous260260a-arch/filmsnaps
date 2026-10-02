-- 003_anon_id.sql
--
-- Adds the anonymous per-install ID (envelope-level, NOT a dim):
--   anon_id TEXT NULL — a random v4-format UUID generated on-device, stored
--   on-device (AsyncStorage), NOT derived from hardware/OS/IP/account.
--   NULL for legacy rows and for events sent before the ID loads.
--
-- Purpose: aggregate-only distinct-install counting (unique viewers,
-- events per install, install-segmented retention). The ID carries no
-- personal data: it is not derived from anything, and deleting it (user
-- toggles statistics off, or clears app data) permanently severs any
-- link to past aggregates — a fresh unrelated UUID is minted on re-enable.
--
-- Privacy contract: this is the ONLY identifier telemetry carries, per
-- the updated policy ("one random ID created when statistics are on,
-- deleted when they're turned off").
--
-- Apply: npx wrangler d1 execute filmsnaps-telemetry --remote --file migrations/003_anon_id.sql

ALTER TABLE telemetry_events ADD COLUMN anon_id TEXT;

-- Distinct-install aggregates group by anon_id over a time range.
CREATE INDEX IF NOT EXISTS idx_telemetry_anon_ts ON telemetry_events(anon_id, ts);

-- Dashboard KPIs slice uniques per day: (day, anon_id).
CREATE INDEX IF NOT EXISTS idx_telemetry_day_anon ON telemetry_events(
  (ts / 86400000),
  anon_id
);

-- Documented privacy contract (no DDL): the anon_id is deleted on-device
-- whenever statistics are disabled, so aggregates can never be re-linked
-- to a re-enabled install. Retention stays 365 days per 001_telemetry.sql.
SELECT 1;
