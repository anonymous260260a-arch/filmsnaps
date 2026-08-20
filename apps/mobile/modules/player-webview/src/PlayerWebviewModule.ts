import { NativeModules, Platform } from "react-native";

const NativeModule = NativeModules.PlayerWebview;

/**
 * Clear all WebView storage state between provider switches.
 * This destroys Cloudflare Service Worker registrations, cookies,
 * WebStorage (LocalStorage/IndexedDB), and disk cache that can
 * poison the shared Chromium renderer process.
 *
 * Must be called BEFORE mounting a new WebView instance.
 */
export async function clearAllState(): Promise<void> {
  if (Platform.OS === "android" && NativeModule?.clearAllState) {
    await NativeModule.clearAllState();
  }
  // iOS: WKWebView isolates storage per-instance — no explicit clear needed,
  // but calling it is a harmless no-op.
}

/**
 * Active OTA config version (Android only). Used by VideoWebView.tsx to
 * defensively invalidate the memoized guard-bundle when the native config
 * changes. Returns 0 on iOS / before the bridge is ready.
 */
export async function getConfigVersion(): Promise<number> {
  if (Platform.OS === "android" && NativeModule?.getConfigVersion) {
    return await NativeModule.getConfigVersion();
  }
  return 0;
}

export default { clearAllState, getConfigVersion };
