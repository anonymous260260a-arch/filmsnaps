# FilmSnaps Ad/Popup Blocking — Expert Response

Received: 2026-07-16
Original consultation: [EXPERT_CONSULTATION.md](./EXPERT_CONSULTATION.md)

---

## TL;DR — The Core Insight

**We are fighting the war at the wrong layer.** Heuristic DOM scraping, monkey-patched `appendChild`, frozen `window.location`, and CPU watchdogs are symptom-level defenses. The proven architecture (uBlock Origin, AdGuard, Brave Shields) is **declarative, list-driven, network-level blocking** with cosmetic CSS as a secondary layer.

**Current:** 80% DOM/runtime hacks → fragile, CPU-heavy, cat-and-mouse  
**Target:** 90% network-level + iframe-sandbox (declarative) → fast, stable, list-maintained

---

## The Architecture

### L0 — Filter List Compiler (the foundation)
- Use `@cliqz/adblocker` (used by Brave, MIT licensed) — compiles EasyList + EasyPrivacy + AdGuard into an optimized in-memory engine
- Output: `compiled-filters.json` with network block/allow rules, cosmetic CSS, CSP directives
- Runs as a CI step, versioned artifact
- **Per-provider overrides** in `packages/filter-compiler/overrides/`

### L1a — Web Proxy Path (same-origin providers, ~60%)
- Existing `/api/player/[provider]/[...path]/route.ts` becomes the primary blocking surface
- Use `@cliqz/adblocker` engine to strip matching `<script>`, `<iframe>`, `<link>`, `<img>` from provider HTML **before it reaches the browser**
- Inject cosmetic CSS + minimal runtime guard
- Set tightened CSP
- **Why bulletproof:** provider scripts matching ad patterns are *physically absent* from the HTML the browser receives

### L1b — Server-Side Cloudflare Solver (the big unlock)
- Headless-browser challenge-solver reverse proxy at `/api/cf-proxy/[provider]/[...path]/route.ts`
- Uses `flaresolverr` or Playwright to solve Cloudflare challenges server-side, cache `cf_clearance` cookie (~30min TTL)
- **Transforms the cross-origin "zero JS injection" scenario into the same-origin "full filter-list application" scenario**
- This closes the Cloudflare gap entirely

### L1c — Web Iframe Sandbox (defense-in-depth)
- Add `sandbox="allow-scripts allow-same-origin allow-presentation"` to iframe
- Deliberately omit `allow-popups`, `allow-popups-to-escape-sandbox`, `allow-top-navigation`
- **Enforced by browser engine**, not by JS that the iframe can override
- Defeats `window.open()`, `a[target=_blank]`, `window.top.location = ...` hijacks

### L1d — Mobile Native Network Blocking (the gold layer)
- **Android:** `shouldInterceptRequest` — intercepts *every* resource request from *every* nested frame at the native layer, before any JS runs
- **iOS:** `WKContentRuleListStore` — same engine Safari's content block app extensions use, compiled to native binary format
- **The "child iframe problem" disappears** on mobile — native layer catches everything

### L2 — Cosmetic Filtering (universal, zero-CPU)
- Cosmetic rules compile to CSS string, injected as `<style id="fs-cosmetic">`
- CSS-only cosmetic filtering is free — handled by browser's style engine
- Use CSS `:has()` instead of JS MutationObserver selectors

### L3 — Minimal Runtime Guard (~50 lines)
- Retains only: `window.open` override, anchor `click()` popup path, debounced MutationObserver for self-healing ads, `attachShadow` interception
- **Removes:** `window.location` freeze, `appendChild` interception, `setInterval` sweeper, popup focus reclaim, CPU watchdog

### L4 — CSP Strategy
- Tighten `script-src`, `frame-src`, `connect-src`, `form-action`, `object-src`, `base-uri` aggressively
- Use per-provider allowlist for video CDN origins
- Drop `navigate-to` (deprecated) — rely on iframe sandbox instead

### L5 — Click & Event Interception (mobile only, native)
- Android: `shouldOverrideUrlLoading` blocks `intent://`, non-https schemes
- iOS: `decidePolicyFor` blocks non-https schemes and null target frames

---

## Things to Retire

| Layer | Status | Reason |
|-------|--------|--------|
| DOM sweeper (setInterval 3s) | ❌ Remove | CPU draw, replaced by debounced MutationObserver + cosmetic CSS |
| Location locking | ❌ Remove | Providers crash on detection; iframe sandbox covers this |
| `appendChild` interception | ❌ Remove | Causes crashes; network blocking is sufficient |
| Popup focus reclaim | ❌ Remove | Modern browsers block `window.focus()` |
| CPU watchdog | ❌ Remove | False positives; miners can't load with network blocking |
| 15-layer `playerGuard.ts` | ❌ Replace | Replace with ~50-line `minimal-guard.ts` |

---

## Key Answers to Our Questions

1. **Architecture:** Declarative filter-list approach via `@cliqz/adblocker`. Network-first (90%), DOM last (10%).

2. **uBlock Origin integration:** Yes — directly integrate `@cliqz/adblocker`. Server-side for proxy, compiled engine JSON for mobile.

3. **Child iframe problem:** Moot with network-level blocking. HTML rewrite strips child-iframe src attrs; CSP `frame-src` blocks misses; mobile native `shouldInterceptRequest` catches everything.

4. **Cloudflare providers:** Headless-browser CF solver unlocks proxy path for CF providers. This is the single biggest architectural unlock.

5. **Mobile native blocking:** Android `shouldInterceptRequest` + iOS `WKContentRuleListStore` are the gold layers.

6. **Race conditions:** Structurally eliminated — native interception fires before JS executes in any frame. On web, iframe sandbox is enforced at parse time.

7. **Shadow DOM:** Network-level filtering is shadow-DOM-immune. Cosmetic CSS covers most of the rest.

8. **CSP strategy:** Tighten `script-src`/`frame-src`/`connect-src`. Keep `media-src` permissive. Use nonce for inline scripts. Drop `navigate-to`.

9. **Filter list maintenance:** Daily CI pulls latest lists, compiles to versioned artifact. Mobile gets base pack in binary + OTA fast pack weekly + optional hot patch on launch.

10. **Performance:** Stop scanning the DOM. Cosmetic CSS is free. Network filtering is sub-microsecond hash lookup. Expected CPU <0.1% vs. current ~10-15%.

---

## Implementation Plan

### Phase 1 (1-2 weeks): New foundation
1. Stand up `packages/filter-compiler/` with EasyList + EasyPrivacy + AdGuard Base
2. Integrate `@cliqz/adblocker` into web proxy route.ts
3. Generate + inject cosmetic CSS server-side
4. Replace 15-layer `playerGuard.ts` with `minimal-guard.ts` (~50 lines)
5. Add `sandbox` attribute to SecureIframe

### Phase 2 (2-3 weeks): Mobile native
6. Android: `shouldInterceptRequest` wired to filter rules
7. iOS: `WKContentRuleListStore` with compiled rules
8. Drop mobile inline guard scripts (replaced by native layer)
9. OTA fast-pack filter updates

### Phase 3 (2 weeks): Cloudflare unlock
10. Stand up `/api/cf-proxy/` with flaresolverr
11. Migrate nxsha, chillflix to CF-solver route
12. Add per-provider `allowedOrigins` to registry

### Phase 4 (1 week): Cleanup + telemetry
13. Remove retired layers from codebase
14. Filter-list effectiveness telemetry
15. False-positive triage workflow
