/**
 * FilmSnaps Desktop — Media Download Sources (nxsha scraper + falix proxy)
 *
 * Ports mobile's two working download sources to the desktop shell:
 *
 *   • nxsha — two paths, API-first (see docs/nxsha-download-api-findings.md):
 *
 *     1. Direct API (primary). The /dl page's CAPTCHA is client-side only —
 *        after solving it the site calls its own encrypted endpoints:
 *          GET /api/servers?q=<enc>  {tmdbId, imdb_id, type, season, episode, method:"dl"}
 *          GET /api/sources?q=<enc>  {…, provider:<scraper>}   → {sources:[…]}
 *        We replicate that exactly from main (AES-256-CBC, OpenSSL Salted__,
 *        URL-safe b64). Structured responses carry real sizes/quality labels
 *        — no DOM scraping, no captcha script fragility.
 *
 *     2. Hidden-window scrape (fallback). If the API path fails (endpoint
 *        moved/removed/rate-limited), fall back to the original approach:
 *        a hidden BrowserWindow loads web.nxsha.app/dl/…, a preload installs
 *        ad-block shims and bridges `nxsha:msg`, and after did-finish-load
 *        (+1.8s hydration) we inject the solve/scrape script.
 *
 *   • falix — a plain REST API (no browser needed). The renderer can't fetch
 *     it directly (CORS), so detail lookups are proxied through main via
 *     `falix:detail`. File downloads themselves go through the DownloadManager.
 *
 * Both sources' downloads run in the dedicated `persist:filmsnaps-dl` session
 * (see download.ts) so they never touch the provider R0–R8 filter stack —
 * these are known-good direct file URLs from our own pages.
 */

import { BrowserWindow, ipcMain, session, shell } from "electron";
import { join } from "path";
import crypto from "crypto";

// ── Constants ──

export const MEDIA_DL_PARTITION = "persist:filmsnaps-dl";

const NXSHA_WEB_BASE = "https://web.nxsha.app";
const NXSHA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
/** Per-provider politeness gap between /api/sources calls. */
const NXSHA_PROVIDER_DELAY_MS = 600;
const NXSHA_API_TIMEOUT_MS = 15000;
const FALIX_API_BASE = "https://dl.falixmovies.com";

// ── Nxsha private-API crypto (replicates the site's encodeData/decodeData) ──

/** Key extracted from nxsha's public client bundle (obfuscation, not secret). */
const NXSHA_API_KEY = Buffer.from([
  83, 56, 120, 33, 74, 107, 52, 90, 80, 49, 117, 71, 56, 36, 109, 121,
]);

/** OpenSSL EVP_BytesToKey (MD5, 1 iteration) — key||iv for AES-256-CBC. */
function evpKdf(password: Buffer, salt: Buffer): Buffer {
  const data = Buffer.concat([password, salt]);
  const out: Buffer[] = [];
  let prev = Buffer.alloc(0);
  let total = 0;
  while (total < 32 + 16) {
    prev = crypto
      .createHash("md5")
      .update(Buffer.concat([prev, data]))
      .digest();
    out.push(prev);
    total += prev.length;
  }
  return Buffer.concat(out);
}

function nxshaEncode(payload: Record<string, unknown>): string {
  const body = JSON.stringify({
    ...payload,
    _req_ts: Date.now(),
    _req_salt: Math.random().toString(36).slice(2, 12),
  });
  const salt = crypto.randomBytes(8);
  const keyiv = evpKdf(NXSHA_API_KEY, salt);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    keyiv.subarray(0, 32),
    keyiv.subarray(32),
  );
  return Buffer.concat([
    Buffer.from("Salted__"),
    salt,
    cipher.update(body, "utf8"),
    cipher.final(),
  ])
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function nxshaDecode(str: string): Record<string, unknown> | null {
  try {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const raw = Buffer.from(b64, "base64");
    if (raw.subarray(0, 8).toString() !== "Salted__") return null;
    const keyiv = evpKdf(NXSHA_API_KEY, raw.subarray(8, 16));
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      keyiv.subarray(0, 32),
      keyiv.subarray(32),
    );
    return JSON.parse(
      Buffer.concat([
        decipher.update(raw.subarray(16)),
        decipher.final(),
      ]).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface NxshaApiServer {
  name?: string;
  scraper?: string;
  id?: number | string;
  isDisable?: boolean;
  dl_support?: boolean;
  position?: number;
}

interface NxApiSource {
  url?: string;
  org_uri?: string;
  quality?: string;
  label?: string;
  provider?: string;
}

/** Solve/scrape script — port of mobile's SOLVE_SCRIPT (download/nxsha). */
const AUTO_SOLVE_TIMEOUT = 30000;
const SCRAPE_TIMEOUT = 15000;
/** Mobile waits 1800ms after onLoadEnd before injecting (React hydration). */
const INJECT_DELAY_MS = 1800;

const SOLVE_SCRIPT = `
(function() {
  var startTime = Date.now();
  var captchaSolved = false;
  var expanded = false;

  function post(type, data) {
    try { window.__nxsha.post(type, data || {}); } catch(e) {}
  }

  // ── CAPTCHA helpers ──
  function findNumbers() {
    var all = document.querySelectorAll('div');
    var nums = [];
    for (var i = 0; i < all.length && nums.length < 2; i++) {
      var text = all[i].textContent.trim();
      if (/^\\d+$/.test(text) && text.length <= 3) {
        nums.push(parseInt(text, 10));
      }
    }
    return nums.length >= 2 ? nums : null;
  }

  function submitAnswer(sum) {
    var input = document.querySelector('input[inputMode="numeric"]');
    var btn = document.querySelector('button[type="submit"]');
    if (!input || !btn) return false;
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, String(sum));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    btn.click();
    return true;
  }

  // ── Accordion expander (only clicks collapsed ones) ──
  function expandAllServers() {
    var allDivs = document.querySelectorAll('div');
    for (var i = 0; i < allDivs.length; i++) {
      var d = allDivs[i];
      if (d.className && typeof d.className === 'string' &&
          d.className.indexOf('overflow-hidden') !== -1 &&
          d.className.indexOf('rounded-[') !== -1) {
        var dlLinks = d.querySelectorAll('a[href]');
        var hasVisible = false;
        for (var j = 0; j < dlLinks.length; j++) {
          if (dlLinks[j].textContent.trim().toLowerCase() === 'download') {
            hasVisible = true; break;
          }
        }
        if (!hasVisible) {
          var btn = d.querySelector('button');
          if (btn && btn.querySelector('h3')) btn.click();
        }
      }
    }
    expanded = true;
  }

  // ── Comprehensive link extractor ──
  function extractAllData() {
    var anchors = document.querySelectorAll('a[href]');
    var items = [];
    var seen = {};

    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.href || '';
      if (!href.startsWith('http')) continue;
      if (seen[href]) continue;

      var text = (a.textContent || '').trim().toLowerCase();
      if (text !== 'download') continue;

      seen[href] = true;

      // Find the label text (nearest span that isn't "Download")
      var label = '';
      var walker = a.parentElement;
      var limit = 8;
      while (walker && limit > 0) {
        var spans = walker.querySelectorAll('span');
        for (var s = 0; s < spans.length; s++) {
          var t = spans[s].textContent.trim();
          if (t && t.toLowerCase() !== 'download' && t.length > 0) {
            label = t;
            break;
          }
        }
        if (label) break;
        walker = walker.parentElement;
        limit--;
      }

      // Find the server name via h3 ancestor
      var serverName = '';
      var up = a.parentElement;
      var upLimit = 12;
      while (up && upLimit > 0) {
        var h3 = up.querySelector('h3');
        if (h3) { serverName = h3.textContent.trim(); break; }
        up = up.parentElement;
        upLimit--;
      }

      items.push({ url: href, label: label || a.textContent.trim(), server: serverName });
    }

    return items;
  }

  // ── CAPTCHA poll ──
  var pollCaptcha = setInterval(function() {
    if (Date.now() - startTime > ${AUTO_SOLVE_TIMEOUT}) {
      clearInterval(pollCaptcha);
      return;
    }
    if (!captchaSolved) {
      var nums = findNumbers();
      if (nums && nums[0] >= 0 && nums[1] >= 0) {
        if (submitAnswer(nums[0] + nums[1])) {
          captchaSolved = true;
          post('captcha-solved', {a: nums[0], b: nums[1]});
          clearInterval(pollCaptcha);
        }
      }
    }
  }, 500);

  // ── Extraction poll (runs concurrently) ──
  var pollExtract = setInterval(function() {
    if (Date.now() - startTime > ${SCRAPE_TIMEOUT}) {
      clearInterval(pollExtract);
      post('scrape-timeout', {});
      return;
    }

    expandAllServers();

    var items = extractAllData();
    if (items.length > 0) {
      var serverMap = {};
      for (var j = 0; j < items.length; j++) {
        var sv = items[j].server || 'Sources';
        if (!serverMap[sv]) serverMap[sv] = [];
        serverMap[sv].push({ url: items[j].url, label: items[j].label });
      }
      var servers = [];
      for (var name in serverMap) {
        servers.push({ name: name, links: serverMap[name] });
      }

      clearInterval(pollCaptcha);
      clearInterval(pollExtract);
      post('download-links', { servers: servers });
    }
  }, 1200);
})();
true;
`;

/** Ad hosts blocked from navigating/opening inside the hidden scraper. */
const NAV_BLOCK_HOSTS = [
  "doubleclick.net",
  "googleadservices",
  "googlesyndication",
  "pagead2",
  "adnxs.com",
  "popads.",
  "popcash.",
  "popunder.",
  "adsterra",
  "propellerads",
  "exoclick",
  "juicyads",
  "plugrush",
  "hakumnata.com",
  "tags.crwdcntrl",
  "crwdcntrl",
  "mgid.com",
  "tawk.to",
  "adservex",
  "onclickads",
  "peachify",
  "trafficwave",
  "trafficboss",
  "clk.sh",
];

function isBlockedNavHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return NAV_BLOCK_HOSTS.some((frag) => host.includes(frag));
  } catch {
    return false;
  }
}

type WindowGetter = () => BrowserWindow | null;

interface NxshaScrapeParams {
  type: "movie" | "tv";
  id: string;
  season?: number;
  episode?: number;
}

/** One extracted link — enriched by the API path, bare from the scraper. */
interface NxshaScrapeLink {
  url: string;
  label: string;
  /** Original (unwrapped) URL from the API path — often the real direct file. */
  orgUri?: string;
  provider?: string;
}

function buildNxshaUrl(p: NxshaScrapeParams): string {
  return p.type === "tv"
    ? `${NXSHA_WEB_BASE}/dl/tv/${p.id}/${p.season ?? 1}/${p.episode ?? 1}`
    : `${NXSHA_WEB_BASE}/dl/movie/${p.id}`;
}

class MediaSources {
  private getWindow: WindowGetter;
  /** Hidden window that renders the nxsha download page while scraping. */
  private scraperWin: BrowserWindow | null = null;
  /** Bumps per scrape so late messages from an old page are ignored. */
  private scrapeSeq = 0;
  private injectTimer: NodeJS.Timeout | null = null;

  constructor(getWindow: WindowGetter) {
    this.getWindow = getWindow;
  }

  init(): void {
    this.registerIpc();
  }

  // ── Renderer → main ────────────────────────────────────────────

  private registerIpc(): void {
    ipcMain.handle("nxsha:scrape", (_e, params: NxshaScrapeParams) =>
      this.scrapeNxsha(params),
    );
    ipcMain.handle("nxsha:cancel", () => this.cancelNxsha());

    // Falix detail proxy — bypasses renderer CORS entirely.
    // 404s throw a distinct message so the renderer can fall back to the
    // IMDB-keyed lookup (falix stores some entries under their IMDB number).
    ipcMain.handle("falix:detail", async (_e, tmdbId: string) => {
      if (!tmdbId || !/^\d+$/.test(String(tmdbId))) {
        throw new Error("Invalid falix id");
      }
      const res = await fetch(
        `${FALIX_API_BASE}/api/id/${String(tmdbId).replace(/^0+(?=\d)/, "")}`,
      );
      if (!res.ok) {
        if (res.status === 404) throw new Error("Falix not found (404)");
        throw new Error(`Falix API error: ${res.status}`);
      }
      // Guard against HTML (host down / sleep page) so we throw a clean error
      // instead of a cryptic "Unexpected token '<'" JSON.parse crash.
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("json")) {
        throw new Error("Falix API returned non-JSON (host down?)");
      }
      return res.json();
    });

    // Open a direct link in the user's real browser (falix "open" affordance).
    ipcMain.handle(
      "media-sources:open-external",
      async (_e, rawUrl: string) => {
        if (typeof rawUrl !== "string") return;
        let parsed: URL;
        try {
          parsed = new URL(rawUrl);
        } catch {
          return;
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
        await shell.openExternal(parsed.toString());
      },
    );
  }

  // ── Page message relay (preload bridge) ────────────────────────

  private onPageMessage = (
    _event: Electron.IpcMainEvent,
    msg: { type?: string; data?: unknown },
  ): void => {
    const win = this.scraperWin;
    if (!win || _event.sender !== win.webContents) return;
    const seq = this.scrapeSeq; // capture — stale scrapers must not relay
    switch (msg?.type) {
      case "captcha-solved":
        this.emitState(seq, { phase: "solving" });
        break;
      case "captcha-timeout":
        this.emitState(seq, { phase: "failed", error: "CAPTCHA timeout" });
        break;
      case "download-links": {
        const data = msg.data as { servers?: unknown } | undefined;
        const servers = Array.isArray(data?.servers) ? data.servers : [];
        this.emitState(seq, { phase: "links", servers });
        break;
      }
      case "scrape-timeout":
        this.emitState(seq, {
          phase: "no-links",
          error: "No download links found",
        });
        break;
      default:
        break;
    }
  };

  private emitState(
    seq: number,
    state:
      | { phase: "loading"; status?: string }
      | { phase: "solving" }
      | { phase: "links"; servers: unknown[] }
      | { phase: "no-links"; error?: string }
      | { phase: "failed"; error?: string },
  ): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("nxsha:state", { seq, ...state });
    }
  }

  // ── Direct API path (primary — see docs/nxsha-download-api-findings.md) ──

  private async nxshaApiGet(
    path: string,
    qObj: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const q = encodeURIComponent(nxshaEncode(qObj));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), NXSHA_API_TIMEOUT_MS);
    try {
      const res = await fetch(`${NXSHA_WEB_BASE}${path}?q=${q}`, {
        headers: {
          "User-Agent": NXSHA_UA,
          Accept: "*/*",
          Referer: `${NXSHA_WEB_BASE}/dl/movie/1`,
        },
        signal: ac.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { _hash?: string };
      const decoded = j && j._hash ? nxshaDecode(j._hash) : null;
      if (!decoded) throw new Error("decode failed");
      return decoded;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch download sources for every dl-capable server via the encrypted
   * endpoints, mirroring exactly what the /dl page does post-captcha.
   * Emits progressive loading status; resolves shaped servers or null.
   */
  private async fetchNxshaApiSources(
    seq: number,
    params: NxshaScrapeParams,
  ): Promise<Array<{ name: string; links: NxshaScrapeLink[] }> | null> {
    try {
      const baseQ = {
        tmdbId: params.id,
        imdb_id: "",
        type: params.type,
        season: String(params.season ?? 1),
        episode: String(params.episode ?? 1),
        method: "dl",
      };
      this.emitState(seq, { phase: "loading", status: "Contacting nxsha…" });
      const srv = await this.nxshaApiGet("/api/servers", baseQ);
      const apiServers = Array.isArray(srv.servers)
        ? (srv.servers as NxshaApiServer[])
        : [];
      const usable = apiServers.filter(
        (s) =>
          s &&
          s.isDisable !== true &&
          s.dl_support !== false &&
          (s.scraper || s.id != null),
      );
      if (usable.length === 0) return null;

      const outServers: Array<{ name: string; links: NxshaScrapeLink[] }> = [];
      let total = 0;
      // Order by the site's own position hint (MbPly is position 1).
      usable.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
      for (const s of usable) {
        const provider = String(s.scraper || s.id);
        await new Promise((r) => setTimeout(r, NXSHA_PROVIDER_DELAY_MS));
        let src: Record<string, unknown> | null = null;
        try {
          src = await this.nxshaApiGet("/api/sources", { ...baseQ, provider });
        } catch {
          continue; // one dead provider must not kill the rest
        }
        const list = Array.isArray(src.sources)
          ? (src.sources as NxApiSource[]).filter(Boolean)
          : [];
        if (list.length === 0) continue;
        const links: NxshaScrapeLink[] = list.map((it) => ({
          url: String(it.url || it.org_uri || ""),
          label: String(it.label || it.quality || "").trim(),
          orgUri: it.org_uri ? String(it.org_uri) : undefined,
          provider,
        }));
        total += links.length;
        outServers.push({ name: String(s.name || provider), links });
        this.emitState(seq, {
          phase: "loading",
          status: `Fetched ${total} source${total === 1 ? "" : "s"} · ${outServers.length} server${outServers.length === 1 ? "" : "s"}`,
        });
      }
      return outServers.length > 0 ? outServers : null;
    } catch {
      return null; // caller falls back to the window scraper
    }
  }

  // ── Scrape lifecycle ───────────────────────────────────────────

  private scrapeNxsha(params: NxshaScrapeParams): { success: boolean } {
    this.scrapeSeq += 1;
    const seq = this.scrapeSeq;

    // Primary: direct encrypted-API fetch (no browser, structured data).
    void this.fetchNxshaApiSources(seq, params).then((apiServers) => {
      if (seq !== this.scrapeSeq) return; // superseded by a newer scrape
      if (apiServers) {
        this.emitState(seq, { phase: "links", servers: apiServers });
        return;
      }
      // Fallback: hidden-window CAPTCHA scrape.
      this.startWindowScrape(seq, params);
    });
    return { success: true };
  }

  /** Legacy path — hidden BrowserWindow + captcha solve script. */
  private startWindowScrape(seq: number, params: NxshaScrapeParams): void {
    const url = buildNxshaUrl(params);

    if (!this.scraperWin || this.scraperWin.isDestroyed()) {
      this.scraperWin = new BrowserWindow({
        show: false,
        width: 480,
        height: 900,
        webPreferences: {
          preload: join(__dirname, "preload", "nxsha-preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: MEDIA_DL_PARTITION,
          javascript: true,
          images: false, // faster + quieter; links/DOM don't need images
          webSecurity: true,
        },
      });
      this.scraperWin.setMenuBarVisibility(false);

      // Navigation containment — mirror mobile's onShouldStartLoadWithRequest.
      this.scraperWin.webContents.on("will-navigate", (e, navUrl) => {
        if (isBlockedNavHost(navUrl)) e.preventDefault();
      });
      // Popups never open (mobile parity: javaScriptCanOpenWindowsAutomatically=false).
      this.scraperWin.webContents.setWindowOpenHandler(() => {
        return { action: "deny" };
      });

      this.scraperWin.webContents.on("did-fail-load", (_e, code, desc) => {
        // code -3 (ABORTED) is transient churn during redirects — ignore.
        if (code === -3) return;
        this.emitState(this.scrapeSeq, {
          phase: "failed",
          error: `Load failed (${code}): ${desc}`,
        });
      });

      ipcMain.on("nxsha:msg", this.onPageMessage);
      this.scraperWin.once("closed", () => {
        this.scraperWin = null;
        if (this.injectTimer) clearTimeout(this.injectTimer);
        this.injectTimer = null;
      });
    }

    this.emitState(seq, { phase: "loading" });

    // did-finish-load fires per navigation; only inject for the current seq.
    const wc = this.scraperWin.webContents;
    const onFinished = () => {
      if (seq !== this.scrapeSeq) return;
      if (this.injectTimer) clearTimeout(this.injectTimer);
      this.injectTimer = setTimeout(() => {
        if (this.scraperWin?.isDestroyed()) return;
        void wc.executeJavaScript(SOLVE_SCRIPT, true).catch(() => {});
      }, INJECT_DELAY_MS);
    };
    wc.once("did-finish-load", onFinished);

    void wc.loadURL(url).catch((err) => {
      this.emitState(seq, {
        phase: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private cancelNxsha(): void {
    if (this.injectTimer) clearTimeout(this.injectTimer);
    this.injectTimer = null;
    if (this.scraperWin && !this.scraperWin.isDestroyed()) {
      this.scraperWin.destroy();
    }
    this.scraperWin = null;
  }
}

let mediaSources: MediaSources | null = null;

/**
 * Create + initialize the singleton MediaSources module. Call once after app
 * ready. Also warms the dedicated media-download session so its will-download
 * hook (attached by DownloadManager) exists before the first explicit start.
 */
export function initMediaSources(getWindow: WindowGetter): void {
  if (mediaSources) return;
  mediaSources = new MediaSources(getWindow);
  mediaSources.init();
  // Touch the partition once so it exists with default (unfiltered) behavior.
  session.fromPartition(MEDIA_DL_PARTITION);
  console.log("[Main] MediaSources initialized (nxsha scraper + falix proxy)");
}
