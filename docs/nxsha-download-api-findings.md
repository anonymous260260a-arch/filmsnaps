# Nxsha Download API — Real-Response Findings (2026-08-22)

Probed with the same AES-256-CBC encodeData/decodeData scheme as streaming
(key `S8x!Jk4ZP1uG8$my`, OpenSSL `Salted__`, URL-safe b64, `_req_ts`/`_req_salt`
appended). Probe: `C:\Users\{user}\AppData\Local\Temp\nxsha-dl-probe.mjs`,
raw JSON: `nxsha-dl-probe-results.json`.

## 1. The CAPTCHA is client-side only — API is directly callable

`/dl/movie/550` SSRs a "Security Check" card (`0 + 0`, numbers hydrate
client-side). Solving it only reveals the UI; the data endpoints never see a
captcha token. Verified by calling them straight from Node:

```
GET /api/servers?q=<enc>   payload {tmdbId, imdb_id:"", type, season:"1", episode:"1", method:"dl"}
GET /api/sources?q=<enc>   payload {…same, provider: <scraper|id>}      method:"dl" is what selects download links
```

Both return `{_hash: enc}` → decoded `{servers:[…]}` / `{sources:[…]}`.
Same flow as streaming except `method:"dl"`.

## 2. Server list shape (4 servers for every probed title)

```json
{
  "id": 2,
  "name": "MbPly-[Multi-Lang]",
  "scraper": "mbox",
  "high_priority": 2,
  "web_support": true,
  "dl_support": true,
  "position": 1,
  "flagImg": "…/IN/flat/64.png",
  "quality": "HD/SD/FHD",
  "status": "online",
  "types": ["movie", "tv"],
  "country": "us",
  "isDisable": false
}
```

Servers: mbox (MbPly-[Multi-Lang]), hdhub4u (4k-bk), k4khdhub (4k-Hub),
filmyfly (FlyVid (FHD)). filmyfly returned **0 sources on every probe**.
Use `scraper` as the provider id. Filter `isDisable===true`; skip empty
sources; order by `position`.

## 3. Source object shape

```json
{
  "id": "k4khdhub-2",
  "provider": "k4khdhub",
  "url": "https://pixel.hubcloud.cx/?id=…",
  "org_uri": "https://…/File.mkv",
  "headers": {},
  "quality": "66.39 GB | 2160p | Hindi | English | DTS | BluRay | x265 | HEVC",
  "label": "<identical to quality>",
  "isEmbed": false,
  "type": "mp4"
}
```

Two label dialects:

- **mbox**: `"Hindi dub : 1080"`, `"Original Audio : 720"`, `"Arabic sub : 480"`,
  `"ptbr dub : 1080"` → `<lang> <dub|sub> : <height>` (no size ever).
- **hdhub4u/k4khdhub**: pipe-separated
  `[SIZE] | QUALITY | LANGS… | [AUDIO] | [SOURCE] | [CODEC] | [FORMAT]`
  e.g. `"720p 1.5 GB | Hindi | English | Bluray | x264"`,
  `" 1.5 GB | …"` (quality missing), `"1080p "` (size+extras missing).

## 4. URL taxonomy (critical for enqueueability)

| Kind                         | Examples                                                                                                                | Downloadable?                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Direct signed CDN mp4 (mbox) | url=`bkl.itsnitrox.tech/xbm//?url=…` wrapper; **org_uri** = real `bcdnxw.hakunaymatata.com/**.mp4?sign=…&t=…`           | yes — use `org_uri`, not url                                    |
| Google direct dump           | `video-downloads.googleusercontent.com/ADGPM2…` (no ext)                                                                | yes                                                             |
| Worker-hosted file           | `*.workers.dev/<hash>::<sig>/<file>.mkv`                                                                                | yes                                                             |
| R2 presigned                 | `*.r2.cloudflarestorage.com/hub/<id>?X-Amz-Signature=…&response-content-disposition=attachment%3B%20filename%3D%22…%22` | yes; filename embedded in disposition; X-Amz-Expires=28800 (8h) |
| pixeldrain direct            | `pixeldrain.dev/api/file/<id>?download`                                                                                 | yes                                                             |
| pixeldrain page              | `pixeldrain.dev/u/<id>`                                                                                                 | landing page only                                               |
| hubcloud gateways            | `hubcloud.cx/drive/admin`, `pixel.hubcloud.cx/?id=…`, `gpdl.hubcloud.cx/?id=…`, `hubcloud.cx/tg/go?id=…`                | NO — HTML landing pages that host their own download button     |

k4khdhub emits each release as a **group of mirrors sharing one label**
(gateway + pixel/gpdl + workers/R2 direct + pixeldrain mirror). The current
page renders all of them as sibling rows → noise, and enqueuing a gateway URL
yields an HTML file.

## 5. Why today's page shows "url with no size"

The desktop scraper DOM-walks anchors for a `<span>` label; when the walker
fails the label arrives empty and the row degrades to a truncated URL. The
API's structured `label`/`size` data was never reaching us because we scrape
the rendered page instead of calling the endpoint the page itself calls.

## 6. Decision

Replace the hidden-BrowserWindow CAPTCHA scrape with direct main-process API
calls (exactly what nxsha's own client does post-captcha). Keep the window
scrape only as automatic fallback if the API path fails. Enrich
`nxshaLinks.ts` to parse both label dialects into
{size, quality, langs[], extras[], filename}, dedupe mirror groups preferring
direct URLs, mark gateways as open-external-only.

Caveats: key is extracted from their public bundle (obfuscation, not secret);
endpoints are unauthenticated and may rate-limit or change — hence the
fallback path stays. Signed URLs expire (~hours) — don't cache link lists to
disk.
