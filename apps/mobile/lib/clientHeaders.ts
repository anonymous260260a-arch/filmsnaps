import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const CLIENT_ID_KEY = "client:installId:v1";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomHex(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function generateInstallId(): string {
  return (
    `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-` +
    `${"89ab"[Math.floor(Math.random() * 4)]}${randomHex(3)}-${randomHex(12)}`
  );
}

function appVersion(): string {
  return (
    (Constants.nativeApplicationVersion as string | null) ||
    Constants.expoConfig?.version ||
    "0.0.0"
  );
}

let cachedInstallId: string | null = null;

(async () => {
  try {
    let stored = await AsyncStorage.getItem(CLIENT_ID_KEY);
    if (!stored || !UUID_RE.test(stored)) {
      stored = generateInstallId();
      await AsyncStorage.setItem(CLIENT_ID_KEY, stored);
    }
    cachedInstallId = stored;
  } catch {
    cachedInstallId = null;
  }
})();

export function getClientHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-client": `mobile-${Platform.OS}`,
    "x-app-version": appVersion(),
  };
  if (cachedInstallId) {
    headers["x-anon-id"] = cachedInstallId;
  }
  return headers;
}
