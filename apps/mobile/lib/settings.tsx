/**
 * SettingsStore — Persistent app settings backed by AsyncStorage.
 *
 * Provides a React Context with getter/setter for all user-facing settings.
 * Settings persist across app restarts and sync in real time via context.
 *
 * FIX A / Phase 1C:
 * - Exactly ONE AsyncStorage read path: `doRead()` via `startSettingsPreload()`.
 * - Read starts from RootLayout's first effect (not module eval).
 * - 5s race is last-resort only; the timer is CLEARED when the read wins so
 *   it never logs a false "timed out" after a successful load.
 * - legalAccepted writes are immediate (no debounce) and logged.
 *
 * Usage:
 *   const { settings, updateSetting } = useSettings()
 *   updateSetting('defaultServer', 'vidsrc')
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MediaType } from "@filmsnaps/shared";
import { launchNow } from "./launchMetrics";

// ── Constants ──

const STORAGE_KEY = "@filmsnaps/settings/v1";

// ── Types ──

export interface AppSettings {
  // Content mode — Hard Mode Split (Movies/TV vs Anime)
  mode: MediaType;

  // Playback
  serverOrder: string[];

  // Advanced
  customProviderUrls: Record<string, string>;

  // Server — default provider to use (empty = auto)
  defaultServer: string;

  // Legal — whether the user has accepted the legal disclaimer
  legalAccepted: boolean;

  // Onboarding
  hasSeenWelcome: boolean;

  // Home page — section ordering (IDs: hero, trending-movies, trending-tv,
  // more-like-this, continue-watching, popular-movies)
  homeRowOrder: string[];

  // Player — whether to show per-server usage notes below player
  showServerNotes: boolean;

  /** Stream selector: max file size on cellular (MB) */
  cellularMaxMB: number;
  /** Stream selector: user cap on max quality (null = no limit) */
  maxQuality: string | null;
  /** Stream selector: preferred audio language ("auto" = Multi > Hindi > English) */
  preferredAudioLanguage: "auto" | "multi" | "hindi" | "english";
  /** Whether the first-run language prompt has been answered */
  hasAnsweredLanguagePrompt: boolean;
  /** Background speed test: enabled (non-blocking, cached) */
  enableSpeedTest: boolean;
  /**
   * Anonymous usage statistics + crash reports (default ON).
   * Telemetry never queues or sends unless legalAccepted AND this flag.
   * Turning it off drops the in-memory queue and stops Sentry init.
   */
  analyticsEnabled: boolean;
  /**
   * F3 consent migration — set true (once) when a pre-toggle legacy user is
   * grandfather-enrolled to analytics OFF so the Settings screen can show the
   * one-time notice pointing at the toggle. Never surfaced otherwise.
   */
  analyticsGrandfathered: boolean;
}

type SettingKey = keyof AppSettings;

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  updateSetting: <K extends SettingKey>(
    key: K,
    value: AppSettings[K],
  ) => Promise<void>;
  resetSettings: () => Promise<void>;
}

// ── Defaults ──

const DEFAULT_SETTINGS: AppSettings = {
  mode: "movie_tv",
  serverOrder: [],
  customProviderUrls: {},
  defaultServer: "",
  legalAccepted: false,
  hasSeenWelcome: false,
  homeRowOrder: [
    "continue-watching",
    "trending-movies",
    "trending-tv",
    "popular-movies",
  ],
  showServerNotes: true,
  cellularMaxMB: 3000,
  maxQuality: null,
  preferredAudioLanguage: "auto",
  hasAnsweredLanguagePrompt: false,
  enableSpeedTest: true,
  analyticsEnabled: true,
  analyticsGrandfathered: false,
};

// ── F3 consent grandfathering ──
// The app is NOT shipped publicly yet, so there are no legacy installs with
// legalAccepted already true from before the analytics toggle existed. Flip
// this to true once a public release exists: users who accepted terms pre-
// toggle get analyticsEnabled forced to false exactly once (one-time notice).
export const GRANDFATHER_LEGACY_ANALYTICS = false;

// ── Single lazy preload ──

let preloadedSettings: AppSettings | null = null;
let preloadDone = false;
let preloadStarted = false;
let preloadPromise: Promise<AppSettings> | null = null;
let readCount = 0;

/**
 * The ONLY AsyncStorage.getItem for STORAGE_KEY in the app.
 * Clears the 5s race timer when the read wins so a successful load never
 * later logs a phantom "timed out" warning.
 */
function doRead(): Promise<AppSettings> {
  readCount += 1;
  const n = readCount;
  console.log(
    `[Settings] getItem #${n} called at t=${launchNow()}ms`,
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AppSettings>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[Settings] Failed to load settings: read #${n} timed out after 5s`,
      );
      resolve(DEFAULT_SETTINGS);
    }, 5000);
  });

  const read = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      console.log(
        `[Settings] getItem #${n} resolved at t=${launchNow()}ms (raw=${
          raw == null ? "null" : `${raw.length}b`
        })`,
      );
      if (raw) {
        try {
          const stored = JSON.parse(raw) as Partial<AppSettings>;
          let merged = { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
          // F3: one-time grandfathering for pre-toggle legacy installs. Only
          // runs when the flag is enabled AND the grandfathered marker is
          // absent; forces analytics off and marks it so the Settings screen
          // shows the one-time notice. Flag is OFF until a public release.
          if (
            GRANDFATHER_LEGACY_ANALYTICS &&
            merged.legalAccepted &&
            !stored.analyticsGrandfathered
          ) {
            merged.analyticsEnabled = false;
            merged.analyticsGrandfathered = true;
            console.log(
              "[Settings] F3: grandfathered legacy install to analytics=off",
            );
          }
          return merged;
        } catch (e) {
          console.warn(`[Settings] getItem #${n} JSON.parse failed:`, e);
          return DEFAULT_SETTINGS;
        }
      }
      return DEFAULT_SETTINGS;
    })
    .catch((e) => {
      console.warn(
        `[Settings] getItem #${n} rejected at t=${launchNow()}ms:`,
        e,
      );
      return DEFAULT_SETTINGS;
    })
    .finally(() => {
      // Kill the race timer once the real read settles — never leave an
      // orphaned 5s warn firing after a successful load.
      if (timer !== undefined) clearTimeout(timer);
    });

  return Promise.race([read, timeout]);
}

/**
 * Idempotent — starts the single settings read. Call from RootLayout's first
 * effect (after the RN bridge / AsyncStorage native module is ready).
 * A second call in the same JS runtime returns the same promise (no 2nd read).
 */
export function startSettingsPreload(): Promise<AppSettings> {
  console.log(
    `[Settings] preload created at t=${launchNow()}ms started=${preloadStarted} readCount=${readCount}`,
  );
  if (preloadStarted && preloadPromise) return preloadPromise;
  preloadStarted = true;

  preloadPromise = doRead().then((s) => {
    preloadedSettings = s;
    preloadDone = true;
    console.log(
      `[Settings] race outcome settled at t=${launchNow()}ms loaded=true legalAccepted=${s.legalAccepted}`,
    );
    return s;
  });

  return preloadPromise;
}

/** Promise for the single preload (starts it if not yet started). */
export function settingsPreloadPromise(): Promise<AppSettings> {
  return startSettingsPreload();
}

/** True once the settings read has resolved (sync check). */
export function isSettingsPreloaded(): boolean {
  return preloadDone;
}

/** Diagnostics: how many AsyncStorage reads have been issued. */
export function getSettingsReadCount(): number {
  return readCount;
}

// ── Context ──

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ── Provider (exactly one instance — RootLayout only) ──

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(
    () => preloadedSettings ?? DEFAULT_SETTINGS,
  );
  const [loaded, setLoaded] = useState(() => preloadDone);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `settings` for persist reads outside setState updaters.
  // Only write this in setState paths below — NOT every render (render-time
  // assign can clobber a pending updateSetting before its setState flushes).
  const settingsRef = useRef<AppSettings>(settings);

  useEffect(() => {
    if (preloadDone) {
      console.log(`[Settings] provider loaded=true (sync) t=${launchNow()}ms`);
      return;
    }
    let cancelled = false;
    startSettingsPreload().then((s) => {
      if (cancelled) return;
      settingsRef.current = s;
      setSettings(s);
      setLoaded(true);
      console.log(`[Settings] provider loaded=true (async) t=${launchNow()}ms`);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist with debounce (300ms) — EXCEPT legalAccepted which is immediate.
  const persist = useCallback(
    (s: AppSettings, immediate = false, logLegalTransition = false) => {
      const write = async () => {
        try {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
          // Only on a false→true transition — not on every settings write
          // while legalAccepted is already true (Phase 3A FIX 9).
          if (logLegalTransition) {
            console.log(
              `[Settings] write legalAccepted resolved at t=${launchNow()}ms`,
            );
          }
        } catch (e) {
          console.warn(`[Settings] write failed at t=${launchNow()}ms:`, e);
        }
      };

      if (immediate) {
        if (persistTimeoutRef.current) {
          clearTimeout(persistTimeoutRef.current);
          persistTimeoutRef.current = null;
        }
        void write();
        return;
      }

      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = setTimeout(write, 300);
    },
    [],
  );

  const updateSetting = useCallback(
    async <K extends SettingKey>(key: K, value: AppSettings[K]) => {
      // CRITICAL: legal acceptance must never be lost to a debounce window.
      const immediate = key === "legalAccepted";
      const prev = settingsRef.current;
      const next = { ...prev, [key]: value };
      settingsRef.current = next;
      setSettings(next);
      const logLegalTransition =
        key === "legalAccepted" && !!value && !prev.legalAccepted;
      persist(next, immediate, logLegalTransition);
    },
    [persist],
  );

  const resetSettings = useCallback(async () => {
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
      console.log(`[Settings] write reset resolved at t=${launchNow()}ms`);
    } catch (e) {
      console.warn(`[Settings] write reset failed:`, e);
    }
  }, []);

  return (
    <SettingsContext.Provider
      value={{ settings, loaded, updateSetting, resetSettings }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

// ── Hook ──

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
