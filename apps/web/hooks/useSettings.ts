/**
 * useSettings — persistent app settings backed by localStorage.
 *
 * Mirrors mobile's `lib/settings.tsx` AppSettings surface so the desktop and
 * web settings pages share one shape. Defaults are identical to mobile so
 * behaviour is consistent across platforms.
 */

import { useState, useCallback, useEffect } from "react";

export interface AppSettings {
  // Playback
  serverOrder: string[];

  // Download
  downloadOverCellular: boolean;
  downloadSpeedLimit: "full" | "balanced" | "slower";

  // Advanced
  customProviderUrls: Record<string, string>;

  // Server — default provider id (empty = auto)
  defaultServer: string;

  // Legal — user accepted the legal disclaimer
  legalAccepted: boolean;

  // Onboarding
  hasSeenWelcome: boolean;

  // Home page — section ordering (desktop layout preset)
  homeRowOrder: string[];

  // Player — show per-server usage notes below player
  showServerNotes: boolean;
}

export type SettingKey = keyof AppSettings;

export const DEFAULT_SETTINGS: AppSettings = {
  serverOrder: [],
  downloadOverCellular: false,
  downloadSpeedLimit: "full",
  customProviderUrls: {},
  defaultServer: "",
  legalAccepted: false,
  hasSeenWelcome: false,
  homeRowOrder: [
    "trending-movies",
    "trending-tv",
    "continue-watching",
    "popular-movies",
  ],
  showServerNotes: true,
};

const STORAGE_KEY = "filmsnaps-settings/v1";

function load(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
      : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let cache: AppSettings | null = null;

function get(): AppSettings {
  if (cache) return cache;
  cache = load();
  return cache;
}

function save(settings: AppSettings): void {
  cache = settings;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable — best effort
  }
}

export function getSettings(): AppSettings {
  return get();
}

export function setSettings(settings: AppSettings): void {
  save(settings);
}

export function updateSetting<K extends SettingKey>(
  key: K,
  value: AppSettings[K],
): void {
  const next = { ...get(), [key]: value };
  save(next);
}

export function resetSettings(): void {
  cache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => get());

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        cache = null;
        setSettings(get());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const updateSetting = useCallback(
    <K extends SettingKey>(key: K, value: AppSettings[K]) => {
      const next = { ...settings, [key]: value };
      setSettings(next);
      save(next);
    },
    [settings],
  );

  const reset = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {}
  }, []);

  return { settings, updateSetting, resetSettings: reset };
}
