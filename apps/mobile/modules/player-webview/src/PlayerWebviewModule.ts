import { NativeModules, Platform } from 'react-native';

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
  if (Platform.OS === 'android' && NativeModule?.clearAllState) {
    await NativeModule.clearAllState();
  }
  // iOS: WKWebView isolates storage per-instance — no explicit clear needed,
  // but calling it is a harmless no-op.
}

export default { clearAllState };
