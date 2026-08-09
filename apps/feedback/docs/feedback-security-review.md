# Security Review — FilmSnaps Feedback Portal

---

## 1. Attack Surface

The Feedback Portal has a minimal attack surface because:

1. **No user authentication** — no session tokens, no JWTs, no passwords to steal
2. **No cookies** — all state is in localStorage (not transmitted to the server)
3. **Two mutation endpoints** — only `POST /api/feedback` and `POST /api/vote` accept write operations
4. **Read-only GET endpoints** — roadmap, changelog, FAQ, feedback listing
5. **One database** — D1, with parameterized queries exclusively
6. **No file uploads** — screenshots are disabled; no file processing pipeline

### Attack Surface Map

```
                     Internet
                        │
                        ▼
              ┌─────────────────┐
              │  Cloudflare CDN  │  ← DDoS protection, WAF (by default)
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Cloudflare      │
              │  Worker          │
              │  (Next.js app)   │
              │                  │
              │  ├─ GET /api/*   │  ← Read-only, no side effects
              │  ├─ POST /api/   │  ← Mutation endpoints (protected)
              │  └─ Static pages │  ← Server-rendered HTML
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  D1 Database     │  ← Parameterized queries only
              │  (feedback-db)   │
              └─────────────────┘
```

---

## 2. Abuse Vectors

### Vector 1: Spam Submissions

**Risk:** High
**Likelihood:** High (every public form gets spam)

**Mitigations:**
- 14-layer abuse prevention pipeline (see architecture doc)
- Turnstile invisible widget blocks automated submissions
- 3-tier rate limiting prevents bulk submissions
- Honeypot field catches simple bots
- Spam scoring auto-rejects scores > 0.7

**Residual risk:** A determined human could manually submit spam at 5 submissions/hour (the fingerprint rate limit). If this becomes a problem:
- Reduce `RATE_LIMIT_FINGERPRINT_MAX` from 5 to 2
- Increase spam scoring sensitivity for link-heavy submissions
- Add a CAPTCHA challenge after N submissions (requires state tracking)

### Vector 2: SQL Injection

**Risk:** Critical (if present)
**Likelihood:** None

**Mitigations:**
- Zero string interpolation — all queries use `stmt.bind(?)` exclusively
- D1's API doesn't accept raw SQL strings in user input paths
- All user input is validated and typed before reaching the database layer

**Residual risk:** None as implemented. If a future contributor adds string interpolation in a query, this changes immediately. Code reviews should flag any `SELECT ... WHERE ... '${userInput}'` pattern.

### Vector 3: XSS (Cross-Site Scripting)

**Risk:** High (if unmitigated)
**Likelihood:** Low

**Mitigations:**
- Server-side: all user input is sanitized through `sanitize()` — HTML tags stripped, HTML entities escaped
- API responses use `Content-Type: application/json` — browsers won't execute HTML responses as scripts
- CSP header restricts script sources to `'self'` and `https://challenges.cloudflare.com`
- The app doesn't render raw HTML anywhere — all text content is rendered as text nodes via React

**Residual risk:** If an admin dashboard is added later that renders feedback HTML without sanitization, XSS becomes possible. Any admin UI must sanitize content before rendering.

### Vector 4: IP Harvesting

**Risk:** Medium (privacy concern)
**Likelihood:** None

**Mitigations:**
- Raw IP addresses are never stored
- IPs are one-way hashed with a server-side secret: `sha256(ip + secret)[:16]`
- The hash cannot be reversed (SHA-256 is one-way)
- Without the secret, you cannot even compare hashes

**Residual risk:** If the `IP_HASH_SECRET` is leaked, an attacker could build a rainbow table for common IP ranges. Keep the secret long and random.

### Vector 5: Rate Limit Bypass

**Risk:** Medium
**Likelihood:** Low

**Mitigations:**
- Three independent rate limit tracks (IP, visitor, fingerprint)
- All three must be exhausted to bypass — one track is hard to fake (IP)
- IP rate limiting doesn't rely on client headers; uses `cf-connecting-ip` (Cloudflare's trusted header)
- D1 rate limiting uses `INSERT ... ON CONFLICT` — no race conditions

**Residual risk:** A botnet with thousands of distinct IPs could bypass IP rate limits. Visitor and fingerprint rate limits would still apply per-device but wouldn't stop the aggregate volume. Turnstile is the primary defense here.

### Vector 6: Denial of Service

**Risk:** Low
**Likelihood:** Low

**Mitigations:**
- Cloudflare's edge network inherently absorbs DDoS traffic
- Workers have built-in CPU time limits (30s per request, but D1 queries take <20ms)
- Rate limiting prevents abuse of mutation endpoints
- Read endpoints use indexed queries — fast even with large datasets

**Residual risk:** A coordinated attack targeting read endpoints could increase Workers billing. Consider adding a cache layer for read endpoints if this becomes a concern.

### Vector 7: Turnstile Token Reuse

**Risk:** Medium
**Likelihood:** Low

**Mitigations:**
- Turnstile tokens are single-use as verified server-side
- Each `POST /api/feedback` call consumes one token
- Token has a 5-minute TTL

**Residual risk:** Within the 5-minute window, a token could be reused if the server-side verification is bypassed. The rate limiter would still catch rapid resubmissions.

### Vector 8: Visitor ID Spoofing

**Risk:** Low
**Likelihood:** Low

**Mitigations:**
- Visitor IDs are UUIDs (122 bits of entropy) — not guessable
- Spoofing another user's UUID only gives access to their vote state, not their data
- No sensitive data is associated with visitor IDs
- Rate limiting prevents brute-force attacks

**Residual risk:** Low because visitor IDs carry no privileges. They only identify for voting and rate limiting.

---

## 3. Privacy Architecture

### Data Collected

| Data Point | Stored? | How | Retention |
|-----------|---------|-----|-----------|
| Visitor UUID | Yes | SHA-256 of UUID in D1 | Indefinite (deletable on request) |
| Device fingerprint | Yes | SHA-256 hash in D1 | Indefinite |
| IP address | **No** | One-way hashed before storage | Hash stored indefinitely |
| Email address | **No** | Not collected | N/A |
| Username | **No** | Not collected | N/A |
| Password | **No** | Not collected | N/A |
| Cookies | **No** | Not used | N/A |
| Browser user agent | Yes (optional) | In `device_info` field | Indefinite |
| App version | Yes (optional) | In `app_version` field | Indefinite |
| Form content | Yes | In `feedback` table | Indefinite (deletable on request) |

### GDPR Compliance

| Right | Implementation |
|-------|---------------|
| Right to erasure | `DELETE FROM feedback WHERE visitor_id = ?` removes all visitor data |
| Right to rectification | Feedback is user-submitted; no server-side correction needed |
| Right to data portability | Export via `wrangler d1 export` |
| Right to object | Stop using the portal; delete localStorage to clear visitor ID |
| Data protection by design | No PII stored; one-way IP hashing; privacy-conscious fingerprinting |

---

## 4. Security Headers

Set on every API response:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer header leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disables unused permissions |
| `Content-Security-Policy` | (see below) | Controls allowed script/style sources |

### Content Security Policy

```
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self' https://challenges.cloudflare.com;
frame-src 'self' https://challenges.cloudflare.com;
base-uri 'self';
form-action 'self';
```

---

## 5. Remaining Risks (Honest Assessment)

### Risk 1: No Authentication for Admin Access

There is no admin dashboard. All database operations require the `wrangler CLI` and Cloudflare authentication. This is secure but inconvenient — you can't easily triage feedback from a browser.

**Until an admin dashboard is built, all database queries go through `wrangler d1 execute`, which requires Cloudflare API access.**

### Risk 2: Offline Queue Data in localStorage

The offline queue stores pending submissions in `localStorage` as plain JSON. This includes the full form content (title, description, etc.).

**Mitigations:** The queue is same-origin only (no other site can read it). If a user clears their browser data or uses a shared computer, the queue is at risk of exposure. The queue persists only until the submission succeeds (max 5 retries).

### Risk 3: Turnstile Depends on Cloudflare CDN

Turnstile's script loads from `challenges.cloudflare.com`. If that domain is unavailable or blocked:
- The feedback form still works (Turnstile token returns null)
- The server-side verification is skipped
- Abuse protection relies on rate limiting and spam scoring instead

**Mitigations:** Rate limiting and spam scoring work independently of Turnstile. The app never crashes if Turnstile is unavailable.

### Risk 4: No Encryption at Rest for D1

Cloudflare D1 encrypts data at rest using the same encryption infrastructure as the rest of Cloudflare's platform. This is transparent and always-on — no configuration needed.

### Risk 5: Database Schema Migration Ris

D1 migrations are applied with `wrangler d1 execute`. If a migration has an error, rolling back requires a compensating migration (no `ROLLBACK` for schema changes in D1).

**Mitigations:** Test migrations on a development D1 instance before applying to production. Take a backup before each migration.

---

## 6. Compliance Checklist

| Requirement | Status | Notes |
|-------------|--------|-------|
| GDPR — Right to erasure | ✅ | Visitor data deletable by visitor_id |
| GDPR — Data minimization | ✅ | No PII stored |
| GDPR — Privacy notice | ✅ | This document linked from feedback form |
| CCPA — Opt-out | ✅ | Clear localStorage to opt out of visitor ID |
| COPPA | ✅ | No personal information collected from children |
| WCAG 2.1 AA | ✅ | Forms meet contrast, label, and keyboard accessibility |
| SOC 2 | ⚠️ | Not certified — no user authentication handled |
| PCI DSS | N/A | No payment processing |

---

## 7. Recommended Improvements

### Short-term (low effort, high impact)

1. **Add a `/robots.txt`** to prevent search indexing of feedback data
   ```
   User-agent: *
   Disallow: /
   ```

2. **Add request size limits** — throw 413 on payloads > 100KB
3. **Add a rate limit on GET endpoints** — prevents rapid scraping of feedback listing

### Medium-term (moderate effort)

4. **Add Content-Security-Policy-Report-Only** — log violations without blocking, then move to enforce
5. **Implement API key for admin operations** — enable future admin dashboard without exposing wrangler
6. **Add CORS headers explicitly** — even though same-origin only, explicit headers prevent surprises

### Long-term (when needed)

7. **Add request validation middleware** — centralized validation for all API routes
8. **Add audit logging** — log all admin operations (e.g., deleting feedback, modifying votes)
9. **Implement rate limiting with exponential backoff** — instead of hard 429, allow gradual recovery

---

## 8. Future Enhancements

### Authentication (OAuth / Cloudflare Access)

If the portal needs authenticated submissions at some point:

- Add Cloudflare Access (Zero Trust) in front of the Worker — instantly adds SSO without code changes
- Visitor IDs become authenticated user IDs
- Rate limits can be relaxed for authenticated users

### Screenshot Uploads

When screenshots are re-enabled:

- Add `r2_buckets` binding to `wrangler.jsonc`
- Create `POST /api/upload` that returns a signed R2 URL
- Client uploads directly to R2 (presigned URL) — never touches the Worker
- The `screenshots` column in D1 already exists — no schema migration needed

See [Future Roadmap](docs/feedback-roadmap.md) for full details on all planned features.
