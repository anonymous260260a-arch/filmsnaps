import { File, Directory, Paths } from "expo-file-system";
import { Platform } from "react-native";

/**
 * Fixes Bug 5: SDK 55 removed the default export / `getInfoAsync` free function from
 * expo-file-system. `import * as FileSystem` no longer has it. This wraps the new
 * File/Directory/Paths API and never throws — callers get { exists: false } instead of
 * a TypeError, matching the old getInfoAsync contract closely enough to be a drop-in.
 */
export interface FileInfo {
  exists: boolean;
  size?: number;
  uri: string;
}

export function getInfoAsync(uri: string): FileInfo {
  try {
    const file = new File(uri);
    if (!file.exists) return { exists: false, uri };
    return { exists: true, size: file.size ?? undefined, uri };
  } catch {
    return { exists: false, uri };
  }
}

export function deleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // best-effort cleanup, never throw
  }
}

export function ensureDirectory(uri: string): void {
  try {
    const dir = new Directory(uri);
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {
    // best-effort
  }
}

/**
 * Fixes Bug 7: `Paths.document` (the SDK 55 replacement for the old
 * `documentDirectory`) can be null/undefined on some Android devices/configurations.
 * Falls back to the app's cache directory rather than producing paths like
 * "undefinedFilmsnaps/" downstream. Mirrors the native side's
 * `getExternalFilesDir(DIRECTORY_DOWNLOADS)/Filmsnaps/` layout on Android.
 */
export function getNativeDownloadDir(): string {
  try {
    const base = Paths.document?.uri ?? Paths.cache?.uri;
    if (!base) throw new Error("no base directory available");
    const dir = `${base}${base.endsWith("/") ? "" : "/"}Filmsnaps/`;
    ensureDirectory(dir);
    return dir;
  } catch {
    // Last-resort fallback: cache dir root. Better than a literal "undefined" path.
    return Paths.cache?.uri ?? "";
  }
}
