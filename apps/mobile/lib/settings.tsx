/**
 * SettingsStore — Persistent app settings backed by AsyncStorage.
 *
 * Provides a React Context with getter/setter for all user-facing settings.
 * Settings persist across app restarts and sync in real time via context.
 *
 * Usage:
 *   const { settings, updateSetting } = useSettings()
 *   updateSetting('autoPlayNext', true)
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Constants ──

const STORAGE_KEY = '@filmsnaps/settings/v1';

// ── Types ──

export interface AppSettings {
  // Playback
  serverOrder: string[];
  autoPlayNext: boolean;
  defaultQuality: string;

  // Download
  downloadQuality: string;
  downloadOverCellular: boolean;

  // Appearance
  subtitleFontSize: 'small' | 'medium' | 'large';
  subtitleLanguage: string;

  // Advanced
  customProviderUrls: Record<string, string>;

  // Server — default provider to use (empty = auto)
  defaultServer: string;

  // Legal — whether the user has accepted the legal disclaimer
  legalAccepted: boolean;
}

type SettingKey = keyof AppSettings;

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  updateSetting: <K extends SettingKey>(key: K, value: AppSettings[K]) => Promise<void>;
  resetSettings: () => Promise<void>;
}

// ── Defaults ──

const DEFAULT_SETTINGS: AppSettings = {
  // Playback
  serverOrder: [],
  autoPlayNext: false,
  defaultQuality: 'Auto',

  // Download
  downloadQuality: '1080p',
  downloadOverCellular: false,

  // Appearance
  subtitleFontSize: 'medium',
  subtitleLanguage: 'English',

  // Advanced
  customProviderUrls: {},

  // Server
  defaultServer: '',

  // Legal
  legalAccepted: false,
};

// ── Context ──

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ── Provider ──

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw);
          setSettings({ ...DEFAULT_SETTINGS, ...stored });
        }
      } catch {}
      setLoaded(true);
    })();
  }, []);

  // Persist with debounce
  const persist = useCallback(async (s: AppSettings) => {
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch {}
    }, 300);
  }, []);

  const updateSetting = useCallback(async <K extends SettingKey>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetSettings = useCallback(async () => {
    setSettings(DEFAULT_SETTINGS);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {}
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loaded, updateSetting, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

// ── Hook ──

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
