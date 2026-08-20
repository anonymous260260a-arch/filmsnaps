/**
 * Offline playback URI helpers.
 *
 * Downloaded files live in the public MediaStore `Downloads/Filmsnaps` collection as
 * `content://media/external/...` URIs (API 29+). To play them in the in-app
 * expo-video player without copying the file, we wrap that URI in our own
 * `OfflineFileProvider` (`content://com.filmsnaps.offline/?u=<encoded>`), which
 * re-serves the MediaStore file descriptor — zero copy, no permission prompt.
 */

export const OFFLINE_PROVIDER_AUTHORITY = "com.filmsnaps.offline";

/** Wrap a MediaStore `content://` download URI in our provider so expo-video can
 *  open it. Pass-through for http(s)/file URLs (streaming + legacy downloads). */
export function toPlayableUri(url: string): string {
  if (url.startsWith("content://media/")) {
    return `content://${OFFLINE_PROVIDER_AUTHORITY}/?u=${encodeURIComponent(url)}`;
  }
  return url;
}
