/**
 * FilmSnaps Desktop — MIME-type video sniffer
 *
 * The authoritative signal for whether a response actually carries video is
 * its Content-Type, not its URL shape. A disguised HLS/DASH segment served as
 * `.woff2`/`.png`/`.css` still comes back with `video/mp4`, `video/mp2t`,
 * `application/dash+xml`, `application/vnd.apple.mpegurl`, or a raw
 * `application/octet-stream`. So:
 *
 *   - MIME sniffing is the VERIFICATION signal (authoritative).
 *   - The URL-shape regex (DISGUISED_MEDIA_REGEX) stays as a DETECTION HINT
 *     for responses whose Content-Type was not observed — it never blocks,
 *     only adds trust, so it can't regress playback.
 *
 * Pure functions only — no electron, no fs, no side effects. Unit-tested.
 */

/** Content-Types that unambiguously mean "this body is a video stream". */
const VIDEO_MIME_MARKERS = [
  "video/", // video/mp4, video/mp2t, video/webm, video/x-flv, …
  "application/dash+xml", // DASH manifest
  "application/vnd.apple.mpegurl", // HLS manifest (Apple)
  "application/x-mpegurl", // HLS manifest
  "application/mpegurl", // HLS manifest
];

/** A raw byte-stream — used for .ts segments and proxied HLS segments. */
const OCTET_STREAM = "application/octet-stream";

/** True when a Content-Type header indicates video content. */
export function isVideoMime(contentType?: string): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().trim();
  for (const marker of VIDEO_MIME_MARKERS) {
    if (ct.includes(marker)) return true;
  }
  return false;
}

/** True when a Content-Type is the generic raw byte-stream. */
export function isOctetStream(contentType?: string): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().trim().includes(OCTET_STREAM);
}

/**
 * Disguised HLS/DASH URL-shape detection — the DETECTION HINT, not the
 * authority. Providers serve video segments with non-video extensions
 * (.woff2, .png, .css, .js) to evade adblockers that match on .ts/.m4s/.mp4.
 * The path still follows HLS packaging conventions (seg-N / init-N / chunk-N /
 * part-N). Ported from mobile's PlayerWebViewOverlayView.DISGUISED_MEDIA_REGEX.
 *
 * Matches:  /v4/np/lnhlsj/seg-1-f1-v1.woff2
 *           /v4/np/lnhlsj/init-f1-a1.woff
 *           /{cdn}/{session}/chunk-3-video.png
 *           /{cdn}/{session}/part-2-data.css
 * Non-match: /fonts/inter/Inter-Regular.woff2  (no seg/init/chunk/part prefix)
 *           /css/main.css
 */
export const DISGUISED_MEDIA_REGEX =
  /(seg|init|chunk|part)(-\d{1,4})?(-[a-zA-Z0-9]+)*\.(woff2?|png|jpg|jpeg|gif|svg|css|js)(\?.*)?$/i;

/** True when a URL path follows HLS/DASH packaging structure with a disguised
 *  extension. Pure — no trust mutation. */
export function isDisguisedMediaUrl(url: string): boolean {
  if (!url) return false;
  try {
    return DISGUISED_MEDIA_REGEX.test(new URL(url).pathname);
  } catch {
    return DISGUISED_MEDIA_REGEX.test(url);
  }
}

/**
 * Sniff a response's Content-Type for the video verdict. MIME is the
 * authority; octet-stream corroborates only when the URL shape (disguised
 * segment or an explicit video extension) agrees.
 *
 * Returns true ONLY for authoritative "this is video" verdicts. Non-video
 * MIME (text/html, application/json, image/*) returns false even if the URL
 * looks video-ish — a real video server does not label its segments
 * text/html. Callers keep their own URL-extension / disguised-path fallbacks
 * for responses with NO observable MIME.
 *
 * @param url             Full URL (used to corroborate octet-stream).
 * @param contentType     Observed Content-Type header value (may be undefined).
 * @param videoExtensions Explicit video extensions to corroborate octet-stream.
 */
export function isVideoResponse(
  url: string,
  contentType?: string,
  videoExtensions: string[] = [],
): boolean {
  if (isVideoMime(contentType)) return true;

  // octet-stream is video ONLY when the URL corroborates (a generic binary
  // download / font blob must never create trust).
  if (isOctetStream(contentType)) {
    if (isDisguisedMediaUrl(url)) return true;
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {}
    const dotIndex = pathname.lastIndexOf(".");
    if (dotIndex !== -1 && dotIndex !== pathname.length - 1) {
      const ext = pathname
        .substring(dotIndex + 1)
        .split("?")[0]
        .split("#")[0]
        .toLowerCase();
      if (videoExtensions.includes(ext)) return true;
    }
    return false;
  }

  return false;
}
