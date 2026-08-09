# Future Roadmap — FilmSnaps Feedback Portal

This document describes how the Feedback Portal can be extended with new features. The architecture is designed so each feature can be added as an independent layer — **no redesign required**.

---

## 1. Authentication & User Accounts

### Current State

No authentication. Visitors are identified by UUID stored in `localStorage`.

### How to Add

**Option A: Cloudflare Access (Recommended)**

Cloudflare Access sits in front of the Worker and provides SSO. No code changes needed:

1. Create an Access application in Cloudflare Zero Trust dashboard
2. Set it to protect `https://filmsnaps-feedback.your-subdomain.workers.dev/*`
3. Choose an identity provider (Google, GitHub, email OTP, etc.)
4. Access injects a `Cf-Access-Authenticated-User-Email` header — available on the server

Code change to `api-helpers.ts`:
```typescript
export function getAuthUser(req: Request): string | null {
  return req.headers.get("Cf-Access-Authenticated-User-Email");
}
```

**Trade-offs:** Users must log in before submitting feedback. Adds friction but eliminates spam concerns. Cloudflare Access is free for up to 50 users.

**Option B: Custom Auth with OAuth**

Add a `POST /api/auth/login` endpoint that exchanges an OAuth token for a session JWT. Store the JWT in an `Authorization` header.

- Requires a session management table in D1 (or JWTs)
- Visitor IDs become optional (tied to user accounts instead)
- Voting can be tied to user accounts rather than device fingerprints

**Not needed unless:** You want user profiles, submission history across devices, or email notifications.

---

## 2. Screenshot Uploads

### Current State

Screenshots are structurally planned but disabled:
- `screenshots` column exists in D1 (`TEXT`, stores JSON array of URLs)
- `screenshots` field exists on the `BugReport` type (optional)
- No R2 binding, no upload endpoint, no upload UI

### How to Enable

**Step 1: Add R2 Binding**

In `wrangler.jsonc`:
```jsonc
{
  "r2_buckets": [
    {
      "binding": "SCREENSHOTS_BUCKET",
      "bucket_name": "filmsnaps-feedback-screenshots",
      "preview_bucket_name": "filmsnaps-feedback-screenshots-dev"
    }
  ]
}
```

**Step 2: Create the Bucket**
```bash
wrangler r2 bucket create filmsnaps-feedback-screenshots
```

**Step 3: Upload API**

Create `app/api/upload/route.ts`:
```typescript
export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  const key = `screenshots/${crypto.randomUUID()}.${file.name.split(".").pop()}`;

  // Using direct upload via presigned URL
  const uploadUrl = await req.env.SCREENSHOTS_BUCKET.createPresignedUrl(key, {
    method: "PUT",
    expiresIn: 3600,
  });

  return Response.json({ uploadUrl, key, publicUrl: `https://r2.dev/${key}` });
}
```

**Step 4: Upload UI**

Add to `BugReportForm.tsx` and `FeatureRequestForm.tsx`:

```typescript
const ScreenshotUpload = ({ onUpload }: { onUpload: (url: string) => void }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Get presigned URL
    const { uploadUrl, publicUrl } = await fetch("/api/upload", {
      method: "POST",
      body: new FormData(e.target.form),
    }).then(r => r.json());

    // Upload directly to R2
    await fetch(uploadUrl, { method: "PUT", body: file });

    onUpload(publicUrl);
  };

  return (
    <div className="space-y-2">
      <Label>Screenshots (optional)</Label>
      <Input type="file" accept="image/*" multiple onChange={handleFile} />
      <p className="text-xs text-muted-foreground">
        Max 5 images, 10MB each. Supported: PNG, JPG, WebP.
      </p>
    </div>
  );
};
```

**Architecture Note:** Files are uploaded **directly to R2** using presigned URLs — they never pass through the Worker. This keeps the Worker fast and avoids 100MB body limits.

**Estimated effort:** 2–3 days.

---

## 3. Notifications & Email

### Current State

No email or push notifications.

### How to Add

**Server-side (using Cloudflare Email Routing or a transactional email service):**

Create `app/api/notify/route.ts`:

```typescript
export async function POST(req: Request) {
  const { type, feedback } = await req.json();

  switch (type) {
    case "new-feedback":
      // Send email to admin via MailChannels or Resend
      break;
    case "status-change":
      // Send notification when a submission's status changes
      break;
  }
}
```

**Option A: MailChannels (Free, Workers-native)**

Cloudflare Workers have a MailChannels integration for sending email:
```typescript
await fetch("https://api.mailchannels.net/tx/v1/send", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: "admin@filmsnaps.com" }] }],
    from: { email: "feedback@filmsnaps.com" },
    subject: `New feedback: ${feedback.title}`,
    content: [{ type: "text/plain", value: feedback.description }],
  }),
});
```

**Option B: Webhook (for custom integrations)**

```typescript
export async function onNewFeedback(feedback: any) {
  await fetch(process.env.ADMIN_WEBHOOK_URL!, {
    method: "POST",
    body: JSON.stringify({ event: "new-feedback", feedback }),
  });
}
```

**Trade-offs:** Email requires DNS configuration (SPF, DKIM). Webhooks are simpler. Notifications are fire-and-forget — no read receipts or delivery guarantees.

**Estimated effort:** 1 day (MailChannels) or 1-2 hours (webhook).

---

## 4. Admin Dashboard

### Current State

No admin interface. All database operations use `wrangler d1 execute`.

### How to Add

Create a protected admin section under `/admin/`:

```typescript
// app/admin/layout.tsx — protected layout
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = getAuthUser(); // From Cloudflare Access header

  if (!user) {
    return <div>Access denied. Cloudflare Access required.</div>;
  }

  return (
    <div className="admin-layout">
      <AdminSidebar />
      <main>{children}</main>
    </div>
  );
}
```

**Suggested pages:**

| Route | Purpose |
|-------|---------|
| `/admin` | Dashboard — counts, recent submissions, spam alerts |
| `/admin/feedback` | List all submissions, filter by status/type/score |
| `/admin/feedback/[id]` | View details, update status, mark as duplicate |
| `/admin/roadmap` | Add/edit roadmap items |
| `/admin/changelog` | Add/edit changelog entries |
| `/admin/faq` | Add/edit FAQ items |
| `/admin/settings` | Rate limit thresholds, spam scoring params |

**Admin API endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| PATCH | `/api/feedback` | Update status, mark duplicate |
| DELETE | `/api/feedback` | Remove spam (with confirmation) |
| POST | `/api/admin/roadmap` | Create roadmap item |
| PUT | `/api/admin/roadmap` | Update roadmap item |
| POST | `/api/admin/changelog` | Create changelog entry |
| POST | `/api/admin/faq` | Create FAQ category/item |
| PUT | `/api/admin/faq` | Update FAQ item |

**Authentication:** Cloudflare Access (recommended) or a simple admin token in `Authorization` header.

**Frontend:** Build as Next.js pages within the same app. Use the same shadcn/ui components. No separate deployment needed.

**Estimated effort:** 1–2 weeks (full admin dashboard) or 3–4 days (minimal triage view).

---

## 5. AI Spam Detection

### Current State

Rule-based spam scoring (7 factors, weighted, deterministic).

### How to Add

**Option A: Cloudflare AI Workers**

Use Cloudflare's Workers AI (running Llama or a text classification model):

```typescript
import { Ai } from "@cloudflare/ai";

export async function classifySpam(text: string, env: Env): Promise<number> {
  const ai = new Ai(env.AI);

  const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
    prompt: `Classify the following text as spam or not spam. Return only a number 0-1 where 1 is definitely spam.

Text: "${text}"

Score:`,
    max_tokens: 10,
  });

  return parseFloat(result.response.trim());
}
```

**Option B: External API (OpenAI/Hugging Face)**

```typescript
const response = await fetch("https://api.openai.com/v1/moderations", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  body: JSON.stringify({ input: text }),
});

const { results } = await response.json();
return results[0].flagged ? 0.9 : 0.1;
```

**Where to integrate:** Add as an additional factor in `calculateSpamScore()` in `api-helpers.ts`. Keep it as a parallel check — the rule-based system handles the common cases, and AI catches novel patterns.

**Trade-offs:** AI inference costs add up (Workers AI is ~$0.001 per call; external APIs cost more) and adds latency (500ms–2s per classification). Use AI as a second pass, not a first-line defense.

**Estimated effort:** 2 days (Workers AI) or 1 day (OpenAI).

---

## 6. Feature Voting Improvements

### Current State

Simple upvote toggle:
- One vote per visitor per item
- Toggle on/off
- Count shown on each item

### Possible Improvements

**Weighted voting** — allow multiple votes (limited by a budget):
```sql
ALTER TABLE votes ADD COLUMN weight INTEGER DEFAULT 1;
```

**Category voting** — vote for features within specific roadmap categories

**Vote comments** — leave a reason when voting:
```sql
CREATE TABLE vote_comments (
  id TEXT PRIMARY KEY,
  vote_id TEXT NOT NULL REFERENCES votes(id),
  comment TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Vote notifications** — notify when a voted-on item changes status

**Estimated effort:** 1–3 days per feature.

---

## 7. Comments & Discussion

### Current State

No comments — submissions are one-way.

### How to Add

Create a `comments` table:

```sql
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id),
  visitor_id TEXT NOT NULL,
  body TEXT NOT NULL,
  parent_id TEXT,              -- for threaded replies
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_feedback ON comments(feedback_id);
```

Add API endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/comments` | Create a comment |
| GET | `/api/comments?feedbackId=X` | List comments for an item |
| DELETE | `/api/comments` | Delete own comment |

Add UI to the feedback detail page (you'd need to build `/feedback/[id]` first).

**Estimated effort:** 3–5 days.

---

## 8. Subscriptions (Follow Feature Requests)

### Current State

No follow/subscription mechanism.

### How to Add

Create a `subscriptions` table:

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id),
  visitor_id TEXT NOT NULL,
  email TEXT,                    -- optional: for email notification
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(feedback_id, visitor_id)
);
```

When a submission's status changes, notify all subscribers:
1. `SELECT visitor_id FROM subscriptions WHERE feedback_id = ?`
2. For each subscriber, send a notification (email, push, or in-app badge)
3. UI shows a "Subscribe to updates" button on each submission

**Trade-offs:** Email subscriptions require a notification service (MailChannels, Resend, etc.) and potentially opt-in confirmation to comply with anti-spam laws.

**Estimated effort:** 3–4 days (without email) or 5–7 days (with email).

---

## 9. Analytics & Insights

### Current State

No analytics — you can query D1 manually for counts and trends.

### How to Add

**Option A: D1 Queries (No Code)**

```bash
# Weekly feedback volume
wrangler d1 execute feedback-db --command "
  SELECT date(created_at) as day, COUNT(*) as count
  FROM feedback
  WHERE created_at > date('now', '-30 days')
  GROUP BY day
  ORDER BY day;
" --remote

# Most requested features
wrangler d1 execute feedback-db --command "
  SELECT f.title, COUNT(v.id) as votes
  FROM feedback f
  LEFT JOIN votes v ON v.feedback_id = f.id
  WHERE f.type = 'feature' AND f.status != 'completed'
  GROUP BY f.id
  ORDER BY votes DESC
  LIMIT 20;
" --remote
```

**Option B: Admin Analytics Page**

Add to the admin dashboard:
- Total submissions over time (line chart)
- Bug vs feature ratio (pie chart)
- Average spam score (trend line)
- Most common severity (bar chart)
- Upvote distribution (histogram)

Use Chart.js (already approved in the design system) or Recharts for React-native charts.

**Estimated effort:** 1 day (D1 queries) or 3–5 days (analytics dashboard).

---

## 10. API Sandbox & Rate Limit Management

### Current State

Rate limits are hardcoded in `api-helpers.ts` and `wrangler.jsonc`.

### Improved Approach

Store rate limit configuration in D1:

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('rate_limit_ip_max', '20'),
  ('rate_limit_visitor_max', '10'),
  ('rate_limit_fingerprint_max', '5'),
  ('rate_limit_window_ms', '3600000');
```

Admin dashboard can update these dynamically without redeploying.

**Estimated effort:** 1 day.

---

## 11. Migration Paths for Each Feature

| Feature | New D1 Tables | New API Endpoints | New UI Components | New Dependencies | Estimated Effort |
|---------|--------------|-------------------|-------------------|-----------------|-----------------|
| Auth (Cloudflare Access) | None | None | Login gate | Cloudflare Access config | 2 hours |
| Auth (custom OAuth) | `sessions`, `users` | `POST /api/auth/*` | Login page | OAuth provider SDK | 2–3 days |
| Screenshot uploads | None | `POST /api/upload` | `ScreenshotUpload` | R2 bucket | 2–3 days |
| Email notifications | None | `POST /api/notify` | None | MailChannels or Resend | 1 day |
| Admin dashboard | None | `PATCH /api/feedback`, etc. | 5–10 admin pages | None | 1–2 weeks |
| AI spam detection | None | None (runs inline) | None | Workers AI | 2 days |
| Comments | `comments` | `POST/GET/DELETE /api/comments` | `CommentThread`, `CommentForm` | None | 3–5 days |
| Subscriptions | `subscriptions` | `POST /api/subscribe` | `SubscribeButton` | Email service | 3–7 days |
| Analytics | None | `GET /api/analytics` | Charts page | Chart.js | 3–5 days |
| Vote improvements | `vote_comments` | `PUT /api/vote` | `VoteComment` | None | 1–3 days |

---

## 12. Summary: What's Ready for Now vs Later

### Ready Now (Production)

The current system is complete and production-ready for:
- Anonymous bug reporting and feature requests
- Public roadmap with upvoting
- Changelog and FAQ display
- Spam prevention (14-layer, no CAPTCHA friction)
- Offline submission queue
- Mobile WebView integration

### Add When Needed

| Priority | Feature | Triggers |
|----------|---------|----------|
| High | Admin triage dashboard | Spam volume or feedback volume makes CLI querying painful |
| High | Email notifications | You want to respond to user submissions |
| Medium | Screenshot uploads | Users need to share visual bugs |
| Medium | Comments | Users need to clarify or discuss submissions |
| Low | Auth | You need cross-device submission history |
| Low | Analytics | You're tracking feedback trends quantitatively |
| Low | AI spam | Rules-based system isn't catching new spam patterns |
