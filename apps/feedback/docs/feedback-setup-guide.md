# Complete Setup Guide — FilmSnaps Feedback Portal

This guide takes you from a blank Cloudflare account to a deployed, production-ready feedback portal.

---

## Table of Contents

1. [Cloudflare Account Setup](#1-cloudflare-account-setup)
2. [Prerequisites](#2-prerequisites)
3. [Clone & Install](#3-clone--install)
4. [D1 Database Setup](#4-d1-database-setup)
5. [Turnstile Setup](#5-turnstile-setup)
6. [Environment Variables](#6-environment-variables)
7. [Local Development](#7-local-development)
8. [Build & Deploy](#8-build--deploy)
9. [Verify Deployment](#9-verify-deployment)

---

## 1. Cloudflare Account Setup

### Required Services

| Service | Required | Free Tier | Paid Tier | Purpose |
|---------|----------|-----------|-----------|---------|
| **Cloudflare Workers** | ✅ Yes | Yes (100k req/day) | Yes ($5+/mo) | Hosts the Next.js app as a Worker |
| **Cloudflare D1** | ✅ Yes | Yes (5GB storage, 100k reads/day) | Included | Database for all feedback data |
| **Cloudflare Turnstile** | ✅ Yes | Yes (unlimited) | Free | Bot detection (no CAPTCHA) |

### Optional Services

| Service | Required | Free Tier | Purpose |
|---------|----------|-----------|---------|
| **Cloudflare R2** | ❌ No | Yes (10GB storage) | Future: screenshot file uploads |
| **Cloudflare Pages** | ❌ No | Yes | Alternative deployment if not using Workers |
| **Cloudflare DNS** | ❌ No | Yes | Custom domain (e.g., feedback.filmsnaps.com) |

### Steps

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and create an account
2. Verify your email address
3. Note your **Account ID** from the Workers & Pages dashboard (needed for wrangler)

> D1 is available on the Workers Free plan, but the D1 storage limits are lower (5GB vs 50GB on paid). For a feedback portal with moderate traffic, the free tier is sufficient.

---

## 2. Prerequisites

### Install Tools

```bash
# Node.js 18+ (required by OpenNext)
node --version   # Must be ≥ 18

# pnpm 9+ (the monorepo uses pnpm)
npm install -g pnpm

# wrangler CLI
npm install -g wrangler

# Authenticate wrangler with your Cloudflare account
wrangler login
```

This opens a browser window. Authorize wrangler to access your Cloudflare account.

### Verify Installation

```bash
node --version
pnpm --version
wrangler --version
wrangler whoami   # Should show your Cloudflare account email
```

---

## 3. Clone & Install

```bash
# Navigate to your monorepo root (wherever your apps/ directory lives)
cd m:\filmsnaps-main

# Install all dependencies
pnpm install

# Navigate to the feedback app
cd apps/feedback
```

---

## 4. D1 Database Setup

### 4a. Create the Database

```bash
# Create a D1 database named 'feedback-db'
wrangler d1 create feedback-db
```

**Expected output:**
```
✅ Successfully created DB 'feedback-db' in region 'APAC'

[[d1_databases]]
binding = "FEEDBACK_DB"
database_name = "feedback-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id` UUID.** You'll need it in the next step.

> **One-time only.** If you already created the database, skip this step. To list existing databases: `wrangler d1 list`

### 4b. Configure the Binding

Open `apps/feedback/wrangler.jsonc` and ensure the `d1_databases` section has the correct UUID:

```jsonc
{
  "d1_databases": [
    {
      "binding": "FEEDBACK_DB",
      "database_name": "feedback-db",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   // ← Your UUID here
    }
  ]
}
```

> In development, you can use `"database_id": "feedback-db"` as a placeholder and override with `--d1 FEEDBACK_DB=feedback-db` when running `wrangler dev`.

### 4c. Apply the Migration

The initial migration creates all 7 tables and seeds them with data:

```bash
# Apply to local D1 (for development)
wrangler d1 execute feedback-db --file migrations/001_initial.sql --local

# Apply to remote D1 (for production)
wrangler d1 execute feedback-db --file migrations/001_initial.sql --remote
```

### 4d. Verify the Migration

```bash
# Check tables exist
wrangler d1 execute feedback-db --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" --remote

# Check seed data loaded
wrangler d1 execute feedback-db --command "SELECT COUNT(*) as roadmap_count FROM roadmap;" --remote
wrangler d1 execute feedback-db --command "SELECT COUNT(*) as faq_count FROM faq_categories;" --remote
```

**Expected:**
- 7 tables (feedback, votes, roadmap, changelog, changelog_changes, faq_categories, faq_items, rate_limits)
- 6 roadmap items
- 5 changelog versions
- 5 FAQ categories (15 items total)

### Database Schema Summary

| Table | Purpose | Seed Data |
|-------|---------|-----------|
| `feedback` | Bug reports + feature requests | None |
| `votes` | Upvote tracking | None |
| `roadmap` | Public roadmap items | 6 items |
| `changelog` | Version release notes | 5 versions |
| `changelog_changes` | Individual change entries | 15 entries |
| `faq_categories` | FAQ groupings | 5 categories |
| `faq_items` | Question/answer pairs | 15 items |
| `rate_limits` | Rate limiting counters | None |

Full schema: [docs/feedback-d1-database-schema.md](docs/feedback-d1-database-schema.md)

---

## 5. Turnstile Setup

Turnstile is Cloudflare's CAPTCHA-free bot detection. It runs as an invisible widget — users never see "select all traffic lights."

### 5a. Create a Turnstile Site

1. Go to [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Click **"Add a site"**
3. **Site name:** `FilmSnaps Feedback`
4. **Widget type:** Invisible (recommended — no user interaction)
5. **Domains:** Enter your deployment domain(s):
   - `filmsnaps-feedback.your-subdomain.workers.dev`
   - `localhost` (for local development)
   - Your custom domain if using one
6. Click **Create**

### 5b. Copy Your Keys

After creation, you'll see two keys:

| Key | Variable | Purpose | Visibility |
|-----|----------|---------|------------|
| **Site Key** | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Used by the browser to render the widget | Public (embedded in HTML) |
| **Secret Key** | `TURNSTILE_SECRET_KEY` | Used server-side to verify tokens | Secret — never expose to the browser |

### 5c. Store the Keys

For **local development**, add to `apps/feedback/.dev.vars`:

```env
TURNSTILE_SECRET_KEY=0x4AAAAAA...
IP_HASH_SECRET=a-very-long-random-string-at-least-64-characters-long...
FEEDBACK_DB_LOCAL=feedback-db
```

For **production**, use wrangler secrets:

```bash
echo "0x4AAAAAA..." | wrangler secret put TURNSTILE_SECRET_KEY
echo "your-64-char-random-secret" | wrangler secret put IP_HASH_SECRET
```

### How Turnstile Works in This App

1. `CloudflareAdapter` constructor calls `getTurnstileToken()` (in `lib/turnstile.ts`)
2. This loads the Turnstile script from `challenges.cloudflare.com`
3. Renders an invisible widget in a temporary `<div>` — no user interaction
4. Callback provides a one-time token
5. Token is sent as the `turnstile-token` HTTP header on mutation requests
6. Server verifies the token via `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`
7. If verification fails, the request is rejected with 429

In **development mode** (no site key configured), Turnstile is skipped — a dev token is returned instead.

---

## 6. Environment Variables

### Complete Variable Reference

| Variable | Required | Source | Public/Secret | Example Value | Where to Set |
|----------|----------|--------|--------------|---------------|--------------|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Yes (prod) | Cloudflare Turnstile dashboard | Public | `0x4AAAAAA...` | `.dev.vars` (dev), `vars` in `wrangler.jsonc` (prod) |
| `TURNSTILE_SECRET_KEY` | Yes (prod) | Cloudflare Turnstile dashboard | **Secret** | `0x4AAAAAA...` | `.dev.vars` (dev), `wrangler secret put` (prod) |
| `IP_HASH_SECRET` | Yes | You generate this | **Secret** | `a6f8d3c1...` (64+ chars random) | `.dev.vars` (dev), `wrangler secret put` (prod) |
| `FEEDBACK_DB` | Yes | Created by `wrangler d1 create` | Auto-injected | _(D1 binding)_ | `wrangler.jsonc` `d1_databases` |
| `ENVIRONMENT` | No (default: production) | You set this | Public | `production` or `development` | `vars` in `wrangler.jsonc` |
| `RATE_LIMIT_IP_MAX` | No (default: 20) | You set this | Public | `20` | `vars` in `wrangler.jsonc` |
| `RATE_LIMIT_VISITOR_MAX` | No (default: 10) | You set this | Public | `10` | `vars` in `wrangler.jsonc` |
| `RATE_LIMIT_FINGERPRINT_MAX` | No (default: 5) | You set this | Public | `5` | `vars` in `wrangler.jsonc` |
| `RATE_LIMIT_WINDOW_MS` | No (default: 3600000) | You set this | Public | `3600000` | `vars` in `wrangler.jsonc` |

### Where Variables Go

**For local development** (`.dev.vars`):
```env
TURNSTILE_SECRET_KEY=0x4AAAAAA...
IP_HASH_SECRET=a6f8d3c1b2e4...
FEEDBACK_DB_LOCAL=feedback-db
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAA...
```

**For production** (`wrangler.jsonc`):
```jsonc
{
  "vars": {
    "ENVIRONMENT": "production",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY": "0x4AAAAAA...",
    "RATE_LIMIT_IP_MAX": "20",
    "RATE_LIMIT_VISITOR_MAX": "10",
    "RATE_LIMIT_FINGERPRINT_MAX": "5",
    "RATE_LIMIT_WINDOW_MS": "3600000"
  }
}
```

**Secrets** (set via CLI, never committed to git):
```bash
echo "0x4AAAAAA..." | wrangler secret put TURNSTILE_SECRET_KEY
echo "your-64-char-secret" | wrangler secret put IP_HASH_SECRET
```

> **Important:** `IP_HASH_SECRET` is used to salt IP addresses before hashing. If you change it, all existing IP hashes in the database become unmatchable (cannot be reverse-mapped, but also cannot be compared to new hashes). Generate a random 64+ character string once and keep it stable.

---

## 7. Local Development

### 7a. Start the Dev Server

```bash
cd apps/feedback

# Without wrangler (standard Next.js dev — API routes run in Node.js, not D1)
pnpm dev
```

This starts the Next.js dev server, typically on `http://localhost:3001`. The API routes run in Node.js but won't have access to D1 — they'll throw. For full local development:

```bash
# With wrangler (simulates the Cloudflare Worker environment, including D1)
wrangler dev --remote --d1 FEEDBACK_DB=feedback-db
```

This runs a local dev server that:
- Compiles the Next.js app (via OpenNext)
- Injects the `FEEDBACK_DB` D1 binding pointing at your remote D1 database
- Provides live reload
- Simulates Turnstile, rate limiting, etc.

> **Why `--remote`?** D1 doesn't have a local emulator that fully replicates the production behavior. Using `--remote` in development means you're reading/writing to the real D1 database. Create a separate dev D1 instance if you don't want to mix dev and production data.

### 7b. Develop Without a Cloudflare Dependency

The app can also run as a plain Next.js app without D1. API routes will fail, but the UI will render. For design work, this is often sufficient.

### 7c. Test Offline Behavior

To test the offline queue:

1. Open DevTools → Network tab
2. Check "Offline" or disconnect your network
3. Submit a form — you should see "Saved offline" toast
4. Reconnect — the queue processes automatically

### 7d. Test Rate Limiting

The rate limits are conservative enough that you won't hit them in normal testing. To test:

1. Temporarily lower the limits to 2–3 in `api-helpers.ts`
2. Submit rapidly — you should get 429 responses
3. Check the `rate_limits` table in D1

### 7e. Debugging

```bash
# View real-time worker logs
wrangler tail

# Query the database directly
wrangler d1 execute feedback-db --command "SELECT * FROM feedback LIMIT 5;" --remote

# Check rate limit counters
wrangler d1 execute feedback-db --command "SELECT * FROM rate_limits ORDER BY counter DESC;" --remote
```

---

## 8. Build & Deploy

### 8a. Build for Cloudflare Workers

```bash
cd apps/feedback

# Build the Next.js app into .next/
pnpm build

# Build the Cloudflare Worker bundle into .open-next/
pnpm cf:build
```

The Cloudflare build produces:
- `.open-next/worker.js` — the compiled Worker script (the entire app)
- `.open-next/assets/` — static assets (JS chunks, CSS, images, fonts)

### 8b. Set Production Secrets

```bash
# Before first deploy, set your secrets
echo "0x4AAAAAA..." | wrangler secret put TURNSTILE_SECRET_KEY
echo "your-64-char-secret" | wrangler secret put IP_HASH_SECRET
```

### 8c. Deploy

```bash
pnpm cf:deploy
# This runs: wrangler deploy
```

**Expected output:**
```
 ⛅️ wrangler 4.x.x
-------------------
Total Upload: xx KiB
Uploaded filmsnaps-feedback (5.45 sec)
Published filmsnaps-feedback (0.41 sec)
  https://filmsnaps-feedback.your-subdomain.workers.dev
  https://your-custom-domain.com (if configured)
```

The first URL is your Worker's default `workers.dev` domain.

### 8d. Deploying Updates

```bash
# After making code changes
pnpm build && pnpm cf:build && pnpm cf:deploy

# Or update seed data (add change/changelog etc.)
wrangler d1 execute feedback-db --file migrations/002_add_items.sql --remote
```

### 8e. CI/CD (GitHub Actions)

Create `.github/workflows/deploy-feedback.yml`:

```yaml
name: Deploy Feedback Portal
on:
  push:
    branches: [main]
    paths:
      - 'apps/feedback/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm --filter feedback build
      - run: pnpm --filter feedback cf:build
      - run: npx wrangler deploy
        working-directory: apps/feedback
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

> **Note:** When deploying via CI/CD, `wrangler secret put` commands for `TURNSTILE_SECRET_KEY` and `IP_HASH_SECRET` must be run **once manually** before the first CI/CD deployment. These secrets persist across deployments.

---

## 9. Verify Deployment

### 9a. Smoke Tests

```bash
# 1. Homepage loads
curl https://filmsnaps-feedback.your-subdomain.workers.dev/

# 2. API — roadmap returns seeded data
curl https://filmsnaps-feedback.your-subdomain.workers.dev/api/roadmap

# 3. API — changelog returns seeded data
curl https://filmsnaps-feedback.your-subdomain.workers.dev/api/changelog

# 4. API — FAQ returns seeded data
curl https://filmsnaps-feedback.your-subdomain.workers.dev/api/faq

# 5. API — empty feedback list (no submissions yet)
curl https://filmsnaps-feedback.your-subdomain.workers.dev/api/feedback
```

### 9b. Submit a Bug (Full Flow)

```bash
curl -X POST https://filmsnaps-feedback.your-subdomain.workers.dev/api/feedback \
  -H "Content-Type: application/json" \
  -H "x-visitor-id: test-0000-0000-0000-000000000000" \
  -H "x-fingerprint: abc123" \
  -d '{
    "type": "bug",
    "title": "Test submission — delete me",
    "description": "This is a test submission to verify the deployment is working correctly.",
    "expectedBehavior": "Should work",
    "actualBehavior": "Testing",
    "stepsToReproduce": "1. Step one\n2. Step two",
    "severity": "low"
  }'
```

**Expected response:** `201 Created` with the created feedback item.

> In production (with Turnstile configured), you need a valid Turnstile token. The test above will work in dev mode but may fail in production if no token is sent.

### 9c. Verify Database

```bash
# Check the test submission is stored
wrangler d1 execute feedback-db --command "SELECT id, title, status, spam_score FROM feedback;" --remote

# Check rate limit counters (should have at least 1 entry from your test)
wrangler d1 execute feedback-db --command "SELECT * FROM rate_limits;" --remote

# Clean up test data
wrangler d1 execute feedback-db --command "DELETE FROM feedback WHERE title = 'Test submission — delete me';" --remote
```

### 9d. Rollback (if needed)

```bash
# View recent deployments
wrangler deployments list

# Rollback to a specific version
wrangler rollback <deployment-id>
```

> Rollbacks only affect the Worker code, not the D1 database schema or data. If a migration caused issues, you must apply a compensating migration manually.

---

## Troubleshooting

### "D1 binding is not defined" or "FEEDBACK_DB is not available"

- Ensure `wrangler.jsonc` has the correct `d1_databases` entry
- Verify the `database_id` matches the output of `wrangler d1 create`
- If running `wrangler dev`, pass `--d1 FEEDBACK_DB=feedback-db`
- Run `wrangler deploy` (not `wrangler publish` — the latter is deprecated)

### "Turnstile token verification failed"

- Ensure `TURNSTILE_SECRET_KEY` is set correctly via `wrangler secret put`
- Verify the site key and secret key match (they come as a pair)
- Check that your domain is listed in the Turnstile widget's allowed domains
- In development, the app skips Turnstile if no site key is configured

### "wrangler deploy" fails

- Run `wrangler whoami` to verify authentication
- Check that `pnpm cf:build` completed successfully before deploying
- Ensure no TypeScript errors: `pnpm typecheck`

### OpenNext build issues

- Ensure `@opennextjs/cloudflare` is at version `^1.19.11` or later
- Check `.open-next/config.json` exists after `pnpm cf:build`
- Verify `open-next.config.ts` exports `defineCloudflareConfig({})`

### 502 Bad Gateway on API routes

- Check Worker logs: `wrangler tail`
- Verify the migration was applied: the D1 tables must exist
- Check for uncaught exceptions in the API route handlers

### Duplicate submission detection not working

- Check that the `feedback` table has the `duplicate_of` column
- Verify the `idx_feedback_search` index exists on `(title, description)`
- Fuse.js threshold of 0.4 is deliberately conservative — adjust in `lib/search.ts` if needed
