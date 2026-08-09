# Operations Guide — FilmSnaps Feedback Portal

How to operate, monitor, and maintain the Feedback Portal after deployment.

---

## 1. Monitoring

### Worker Health

```bash
# View real-time logs
wrangler tail

# Check invocation counts, errors, and duration
# → Cloudflare Dashboard → Workers & Pages → filmsnaps-feedback → Metrics
```

The dashboard shows:
- **Requests** — total invocations over time
- **Errors** — 5xx responses, uncaught exceptions
- **CPU time** — duration per request (D1 queries should take <50ms)
- **Status codes** — breakdown of 2xx/4xx/5xx responses

### D1 Health

```bash
# Query count and storage
# → Cloudflare Dashboard → D1 → feedback-db
```

The D1 dashboard shows:
- **Read queries** — per-day read volume
- **Write queries** — per-day write volume
- **Storage** — total database size (start small, grow with usage)
- **Rows** — row count per table

### Alert-Worthy Signals

| Signal | What to Do |
|--------|-----------|
| Error rate > 1% for 5 minutes | Check `wrangler tail` for stack traces |
| D1 query latency > 200ms | Check for missing indexes or large table scans |
| Rate limit counters > 1000 entries/hour | Potential abuse spike — lower rate limits temporarily |
| Spam score > 0.7 submissions increasing | Review spam scoring thresholds in `api-helpers.ts` |
| Turnstile verification failures > 10% | Check Turnstile dashboard for key expiry or domain issues |
| Workers billing spike | Review rate limits — may need tighter controls |

### Manual Health Check

```bash
# Quick health check script
curl -s -o /dev/null -w "%{http_code}" https://filmsnaps-feedback.your-subdomain.workers.dev/api/roadmap
# Should return 200

curl -s -o /dev/null -w "%{http_code}" https://filmsnaps-feedback.your-subdomain.workers.dev/api/faq
# Should return 200
```

---

## 2. Viewing Feedback

### Via D1 Queries

```bash
# All bugs, newest first
wrangler d1 execute feedback-db --command \
  "SELECT id, title, status, severity, spam_score, created_at FROM feedback WHERE type = 'bug' ORDER BY created_at DESC;" \
  --remote

# All feature requests, newest first
wrangler d1 execute feedback-db --command \
  "SELECT id, title, status, spam_score, created_at FROM feedback WHERE type = 'feature' ORDER BY created_at DESC;" \
  --remote

# High-spam submissions (flagged for review)
wrangler d1 execute feedback-db --command \
  "SELECT id, title, type, spam_score, honeypot_caught FROM feedback WHERE spam_score > 0.3 ORDER BY spam_score DESC;" \
  --remote

# Open items needing attention
wrangler d1 execute feedback-db --command \
  "SELECT id, title, type, status, created_at FROM feedback WHERE status = 'open' ORDER BY created_at;" \
  --remote

# Most upvoted feature requests
wrangler d1 execute feedback-db --command \
  "SELECT f.id, f.title, COUNT(v.id) as votes FROM feedback f LEFT JOIN votes v ON v.feedback_id = f.id WHERE f.type = 'feature' GROUP BY f.id ORDER BY votes DESC LIMIT 10;" \
  --remote
```

### Viewing Full Details

```bash
# Full bug report details
wrangler d1 execute feedback-db --command \
  "SELECT * FROM feedback WHERE id = 'bug_1712345678_a1b2c3d4';" \
  --remote

# All votes for a specific item
wrangler d1 execute feedback-db --command \
  "SELECT * FROM votes WHERE feedback_id = 'bug_1712345678_a1b2c3d4';" \
  --remote
```

---

## 3. Updating Roadmap

Roadmap items are seeded via SQL migration. To add or update items, write a new migration or use D1 queries directly.

### Add a New Roadmap Item

```bash
wrangler d1 execute feedback-db --command \
  "INSERT INTO roadmap (id, title, description, status, progress, estimated_release) VALUES \
  ('rm_next', 'Offline Support', 'Full offline support for downloaded movies', 'planned', 0, 'Q3 2025');" \
  --remote
```

### Update Status or Progress

```bash
# Mark as in-progress
wrangler d1 execute feedback-db --command \
  "UPDATE roadmap SET status = 'in-progress', progress = 25, updated_at = datetime('now') WHERE id = 'rm_next';" \
  --remote

# Mark as completed
wrangler d1 execute feedback-db --command \
  "UPDATE roadmap SET status = 'completed', progress = 100, updated_at = datetime('now') WHERE id = 'rm_next';" \
  --remote
```

### Remove a Roadmap Item

```bash
wrangler d1 execute feedback-db --command \
  "DELETE FROM roadmap WHERE id = 'rm_next';" \
  --remote
```

> **Recommendation:** For regular updates, create a small admin script or use a SQL client (like DBeaver or TablePlus with the D1 HTTP API). For infrequent updates, direct D1 queries are simplest.

---

## 4. Publishing Changelog

### Add a New Version

```sql
-- Step 1: Insert the version
INSERT INTO changelog (version, release_date) VALUES ('1.1.0', '2025-04-15');

-- Step 2: Add changes
INSERT INTO changelog_changes (version, change_type, description) VALUES
  ('1.1.0', 'feature', 'New download manager'),
  ('1.1.0', 'fix', 'Fixed crash on search screen'),
  ('1.1.0', 'improvement', 'Reduced memory usage by 30%'),
  ('1.1.0', 'security', 'Updated SSL certificate handling');
```

Execute via `wrangler d1 execute`:

```bash
wrangler d1 execute feedback-db --file migrations/002_v1.1.0.sql --remote
```

Where `002_v1.1.0.sql` contains the INSERT statements above.

### Verify the Changelog

```bash
curl https://filmsnaps-feedback.your-subdomain.workers.dev/api/changelog
```

---

## 5. Database Backups

### Manual Backup

```bash
# Export all tables to SQL
wrangler d1 export feedback-db --remote --output ./backups/feedback-$(date +%Y%m%d).sql
```

### Scheduled Backups (via GitHub Actions)

Create `.github/workflows/backup-feedback.yml`:

```yaml
name: Backup Feedback D1
on:
  schedule:
    - cron: '0 6 * * 0'  # Every Sunday at 6:00 UTC

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install -g wrangler
      - run: wrangler d1 export feedback-db --remote --output ./backups/feedback-$(date +%Y%m%d).sql
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - uses: actions/upload-artifact@v4
        with:
          name: feedback-db-backup-$(date +%Y%m%d)
          path: ./backups/feedback-*.sql
```

### What a Backup Contains

A D1 export is a plain SQL file containing all table data as INSERT statements. It includes:
- All feedback submissions (bugs + feature requests)
- All votes
- All roadmap items
- All changelog entries
- All FAQ content
- All rate limit counters (safe to include — they'll reset on restore)

A full backup is typically <1 MB for a small-to-medium feedback portal.

---

## 6. Restoring a Backup

```bash
# Create a fresh database (you can't restore into an existing one)
wrangler d1 create feedback-db-restored

# Import the backup
wrangler d1 execute feedback-db-restored --file ./backups/feedback-20250415.sql --remote

# Verify
wrangler d1 execute feedback-db-restored --command "SELECT COUNT(*) FROM feedback;" --remote

# Update wrangler.jsonc to point to the restored database
# Then redeploy: pnpm cf:deploy
```

> **Limitations:** D1 doesn't support in-place restore. You must create a new database and update your binding. Schema changes (e.g., new columns) won't be in the backup — you may need to reapply migrations.

---

## 7. Maintenance

### Regular Tasks

| Frequency | Task | Command |
|-----------|------|---------|
| Weekly | Review new feedback submissions | `SELECT * FROM feedback WHERE status = 'open' ORDER BY created_at DESC LIMIT 20;` |
| Weekly | Check rate limit abuse | `SELECT * FROM rate_limits ORDER BY counter DESC LIMIT 10;` |
| Monthly | Review spam detection accuracy | `SELECT * FROM feedback WHERE spam_score > 0.3 ORDER BY spam_score DESC;` |
| Monthly | Update roadmap | Insert/update roadmap items based on feedback trends |
| Monthly | Publish changelog | Insert new changelog version with changes |
| Quarterly | Backup database | `wrangler d1 export feedback-db --remote --output backup.sql` |
| Quarterly | Review Turnstile keys | Check expiry; rotate if needed |
| Per-release | Deploy code changes | `pnpm build && pnpm cf:build && pnpm cf:deploy` |

### Optimal D1 Maintenance

D1 is serverless — there's no vacuum, index rebuild, or connection pool to manage. The database handles these automatically. However:

- **Large tables:** If `feedback` exceeds 100k rows, consider archiving old entries (status = resolved, created > 6 months ago) to a secondary D1 database
- **Index usage:** All queries use indexed columns (`id`, `type`, `status`, `visitor_id`); no full table scans should occur in normal operation

---

## 8. Upgrades

### Upgrading Next.js

```bash
pnpm update next react react-dom @opennextjs/cloudflare
pnpm build
pnpm cf:build
pnpm cf:deploy
```

Check the [Next.js upgrade guide](https://nextjs.org/docs/upgrading) for breaking changes.

### Upgrading OpenNext

```bash
pnpm update @opennextjs/cloudflare
pnpm cf:build
pnpm cf:deploy
```

OpenNext is under active development. Breaking changes are rare but check the [OpenNext changelog](https://github.com/opennext-js/opennext-cloudflare/releases).

### Upgrading Wrangler

```bash
pnpm update wrangler
```

Wrangler updates often improve D1 compatibility and dev server behavior.

---

## 9. Troubleshooting

| Problem | Likely Cause | Solution |
|---------|-------------|----------|
| API returns 500 | Uncaught exception in route handler | Check `wrangler tail` for stack trace |
| API returns 502 | D1 binding not injected | Verify `wrangler.jsonc` D1 config; ensure `cf:build` ran |
| Turnstile always fails | Secret key not set or wrong | Verify with `wrangler secret list` |
| Rate limits not working | `rate_limits` table doesn't exist | Apply migration |
| Offline queue not processing | `window.online` event not firing | Check browser permissions; queue processes on manual page reload too |
| Duplicate detection not showing | Fuse.js threshold too strict or data not loaded | Adjust threshold in `lib/search.ts` |
| Form validation error appears instantly | Zod validation on keystroke | Should validate on blur — check form configuration |
| Theme not persisting across pages | `next-themes` provider not wrapping pages | Check `app/layout.tsx` for `ThemeProvider` |

---

## 10. Security Incident Response

If you suspect the feedback portal has been compromised:

1. **Block traffic:** Temporarily deploy a 503 page or add IP filtering in `wrangler.jsonc`
2. **Backup data:** Export D1 to preserve evidence
3. **Audit logs:** Check `wrangler tail` logs for anomalous patterns
4. **Rotate secrets:**
   ```bash
   wrangler secret put TURNSTILE_SECRET_KEY   # New key from Turnstile dashboard
   wrangler secret put IP_HASH_SECRET          # New random string
   ```
5. **Restore from backup** if data was corrupted
6. **Notify users** if PII was affected (unlikely — no PII is stored)

---

## 11. Cost Management

The Feedback Portal runs entirely on Cloudflare's free/cheap tiers:

| Service | Free Tier Limit | Estimated Monthly Cost |
|---------|----------------|----------------------|
| Workers | 100k requests/day | $0 (typical feedback portal: <1k req/day) |
| D1 | 5GB storage, 100k reads/day | $0 (feedback data is text — <50MB for years) |
| Turnstile | Unlimited | $0 |

**At scale** (10k+ submissions/month):
- Workers: $5/month (Workers Paid)
- D1: ~$0.50/month (reads/writes on D1 Paid)

**Cost optimization tips:**
- D1 reads are billed per query — batch queries where possible (the API already does this)
- Workers duration billing: D1 queries take <20ms — keep them fast
- No CDN costs — Workers are already served from edge locations
