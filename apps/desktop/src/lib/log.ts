/**
 * FilmSnaps Desktop — Centralized Logging System
 *
 * Category-based logging controlled by FILMSNAPS_LOG env var.
 *
 * Usage:
 *   FILMSNAPS_LOG=*              → all logs (default when unset)
 *   FILMSNAPS_LOG=net            → only network filtering
 *   FILMSNAPS_LOG=net,security   → network + security
 *   FILMSNAPS_LOG=none           → silence everything
 *
 * Categories:
 *   net       — R0-R8 request cascade, block/allow decisions, trust tracking
 *   security  — CDP, L8 injection, frame sweep, preload verification
 *   nav       — navigation guard, home escape, redirects
 *   config    — provider config, filter engine, OTA healing
 *   main      — lifecycle, IPC, session init
 *   updater   — auto-update
 *   cosmetic  — cosmetic CSS/scriptlet injection
 *   fs        — fullscreen debug tracing
 *   provider  — provider console forwarding, STREAM-AUDIT
 *   audit     — allow-side request audit (FILMSNAPS_AUDIT)
 *   media     — downloads, nxsha scraper, falix proxy
 *   cdn       — CDN diagnostic header/cookie capture (FILMSNAPS_CDN_DIAG)
 */

type LogCategory =
  | "net"
  | "security"
  | "nav"
  | "config"
  | "main"
  | "updater"
  | "cosmetic"
  | "fs"
  | "provider"
  | "audit"
  | "media"
  | "cdn";

// ── Parse FILMSNAPS_LOG env var ──
const raw = process.env.FILMSNAPS_LOG?.toLowerCase().trim();
let enabledCategories: Set<LogCategory> | null = null; // null = all enabled

if (raw && raw !== "*") {
  if (raw === "none") {
    enabledCategories = new Set(); // empty = nothing enabled
  } else {
    enabledCategories = new Set(
      raw.split(/[,\s]+/).filter(Boolean) as LogCategory[],
    );
  }
}

function isEnabled(cat: LogCategory): boolean {
  if (enabledCategories === null) return true; // unset = all on
  return enabledCategories.has(cat);
}

// ── Logger factory ──
// Wraps the *patched* console methods so the TAG_PATTERN filter applies
// even to our own logger output. makeLogger closures capture _origLog/_origWarn/_origError
// (set below) to avoid double-filtering: our tags already passed isOurs, so we
// write directly to the original; third-party console.log hits the patched wrapper first.
let _origLog = console.log.bind(console);
let _origWarn = console.warn.bind(console);
let _origError = console.error.bind(console);

function makeLogger(
  cat: LogCategory,
  tag: string,
  level: "log" | "warn" | "error" = "log",
) {
  const prefix = `[${tag}]`;
  const fn =
    level === "error" ? _origError : level === "warn" ? _origWarn : _origLog;
  return (...args: unknown[]) => {
    if (isEnabled(cat)) fn(prefix, ...args);
  };
}

// ── Exported per-category loggers ──
export const net = {
  log: makeLogger("net", "NET", "log"),
  /** Allow decision — which rule let it through */
  allow: (rule: string, url: string) => {
    if (isEnabled("net"))
      console.log("[NET]", `ALLOW [${rule}]`, url.slice(0, 150));
  },
  /** Block decision — which rule killed it */
  block: (rule: string, reason: string, url: string) => {
    if (isEnabled("net"))
      console.log("[NET]", `BLOCK [${rule}]`, reason, "—", url.slice(0, 150));
  },
  /** Request entering the cascade */
  request: (method: string, url: string) => {
    if (isEnabled("net")) console.log("[NET]", `${method}`, url.slice(0, 150));
  },
  /** Response received */
  response: (status: string, url: string) => {
    if (isEnabled("net"))
      console.log("[NET]", `← ${status}`, url.slice(0, 120));
  },
  /** Trust acquisition */
  trust: (host: string, detail: string) => {
    if (isEnabled("net")) console.log("[NET]", `TRUST`, host, detail);
  },
  /** Navigation events */
  nav: (url: string) => {
    if (isEnabled("net")) console.log("[NET]", `NAV →`, url);
  },
};

export const security = {
  log: makeLogger("security", "SecurityFilter", "log"),
  warn: makeLogger("security", "SecurityFilter", "warn"),
  error: makeLogger("security", "SecurityFilter", "error"),
};

export const nav = {
  log: makeLogger("nav", "NavGuard", "log"),
  warn: makeLogger("nav", "NavGuard", "warn"),
  error: makeLogger("nav", "NavGuard", "error"),
};

export const config = {
  log: makeLogger("config", "Config", "log"),
  warn: makeLogger("config", "Config", "warn"),
  error: makeLogger("config", "Config", "error"),
};

export const main = {
  log: makeLogger("main", "Main", "log"),
  warn: makeLogger("main", "Main", "warn"),
  error: makeLogger("main", "Main", "error"),
};

export const updater = {
  log: makeLogger("updater", "Updater", "log"),
  error: makeLogger("updater", "Updater", "error"),
};

export const cosmetic = {
  log: makeLogger("cosmetic", "cosmetic", "log"),
};

export const fs = {
  log: makeLogger("fs", "FS-DEBUG", "log"),
  provider: makeLogger("fs", "FS-PROVIDER", "log"),
};

export const provider = {
  log: makeLogger("provider", "ProviderView", "log"),
};

export const media = {
  log: makeLogger("media", "Media", "log"),
  warn: makeLogger("media", "Media", "warn"),
  error: makeLogger("media", "Media", "error"),
};

export const audit = {
  log: makeLogger("audit", "ReqLog", "log"),
};

export const cdn = {
  log: makeLogger("cdn", "CDN", "log"),
  warn: makeLogger("cdn", "CDN", "warn"),
};

// ── Silence non-log console calls in production ──
// Redirect console.log/warn/error from third-party code so their noise
// doesn't appear. Only calls tagged with our prefixes pass through.
if (enabledCategories !== null) {
  const TAG_PATTERN =
    /^\[(NET|SecurityFilter|NavGuard|Config|Main|Updater|cosmetic|FS-DEBUG|FS-PROVIDER|ProviderView|ReqLog|Media|Mpv|MpvManager|mpv:start|mpv:play|mpv:destroy|ProviderSecurity|ProviderConfig|HealEvents|UrlSubstring|FilterEngine|HtmlInjector|Structural|FrameSweep|StreamAudit|Preload)\]/;

  // Tag → category lookup so the patched console can decide enablement
  const TAG_CAT: Record<string, LogCategory> = {
    NET: "net",
    SecurityFilter: "security",
    NavGuard: "nav",
    Config: "config",
    Main: "main",
    Updater: "updater",
    cosmetic: "cosmetic",
    "FS-DEBUG": "fs",
    "FS-PROVIDER": "fs",
    ProviderView: "provider",
    ReqLog: "audit",
    Media: "media",
    Mpv: "media",
    MpvManager: "media",
    "mpv:start": "media",
    "mpv:play": "media",
    "mpv:destroy": "media",
    ProviderSecurity: "security",
    ProviderConfig: "config",
    HealEvents: "config",
    UrlSubstring: "config",
    FilterEngine: "config",
    HtmlInjector: "security",
    Structural: "security",
    FrameSweep: "security",
    StreamAudit: "provider",
    Preload: "security",
  };

  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string") {
      const m = (args[0] as string).match(TAG_PATTERN);
      if (m && !isEnabled(TAG_CAT[m[1]])) return; // category filtered out
    }
    _origLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string") {
      const m = (args[0] as string).match(TAG_PATTERN);
      if (m && !isEnabled(TAG_CAT[m[1]])) return;
    }
    _origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    // Always let errors through — they're important
    _origError(...args);
  };
}

// ── Diagnostic: print active categories on startup ──
export function printLogConfig(): void {
  if (enabledCategories === null) {
    console.log("[Log] All categories active (FILMSNAPS_LOG not set)");
  } else if (enabledCategories.size === 0) {
    console.log("[Log] Logging disabled (FILMSNAPS_LOG=none)");
  } else {
    console.log(
      "[Log] Active categories:",
      Array.from(enabledCategories).join(", "),
    );
  }
}
