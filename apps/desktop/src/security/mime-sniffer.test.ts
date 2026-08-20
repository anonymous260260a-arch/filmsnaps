import { describe, it, expect } from "vitest";
import {
  isVideoMime,
  isOctetStream,
  isDisguisedMediaUrl,
  isVideoResponse,
  DISGUISED_MEDIA_REGEX,
} from "./mime-sniffer";

const VIDEO_EXTS = [
  "m3u8",
  "mpd",
  "ts",
  "m4s",
  "mp4",
  "webm",
  "mkv",
  "m4v",
  "3gp",
  "cmfv",
  "cmfa",
  "aac",
  "key",
];

describe("mime-sniffer — isVideoMime (Phase 2c authority)", () => {
  it("accepts video/* Content-Types", () => {
    expect(isVideoMime("video/mp4")).toBe(true);
    expect(isVideoMime("video/mp2t")).toBe(true);
    expect(isVideoMime("video/webm; codecs=vp9")).toBe(true);
    expect(isVideoMime("VIDEO/MP4")).toBe(true); // case-insensitive
  });

  it("accepts DASH/HLS manifest types", () => {
    expect(isVideoMime("application/dash+xml")).toBe(true);
    expect(isVideoMime("application/vnd.apple.mpegurl")).toBe(true);
    expect(isVideoMime("application/x-mpegurl")).toBe(true);
    expect(isVideoMime("application/mpegurl")).toBe(true);
  });

  it("rejects non-video types", () => {
    expect(isVideoMime("text/html")).toBe(false);
    expect(isVideoMime("application/json")).toBe(false);
    expect(isVideoMime("image/png")).toBe(false);
    expect(isVideoMime(undefined)).toBe(false);
    expect(isVideoMime("")).toBe(false);
  });
});

describe("mime-sniffer — isOctetStream", () => {
  it("detects the raw byte-stream type", () => {
    expect(isOctetStream("application/octet-stream")).toBe(true);
    expect(isOctetStream("video/mp4")).toBe(false);
    expect(isOctetStream(undefined)).toBe(false);
  });
});

describe("mime-sniffer — isDisguisedMediaUrl (detection hint)", () => {
  it("matches HLS/DASH packaging shapes with disguised extensions", () => {
    expect(
      isDisguisedMediaUrl(
        "https://cdn.provider.io/v4/np/lnhlsj/seg-1-f1-v1.woff2",
      ),
    ).toBe(true);
    expect(
      isDisguisedMediaUrl(
        "https://cdn.provider.io/v4/np/lnhlsj/init-f1-a1.woff",
      ),
    ).toBe(true);
    expect(
      isDisguisedMediaUrl("https://cdn.provider.io/x/y/chunk-3-video.png"),
    ).toBe(true);
    expect(
      isDisguisedMediaUrl("https://cdn.provider.io/x/y/part-2-data.css"),
    ).toBe(true);
    // query string tolerated on a DISGUISED extension
    expect(
      isDisguisedMediaUrl(
        "https://cdn.provider.io/x/seg-1-f1-v1.woff2?token=abc",
      ),
    ).toBe(true);
  });

  it("does NOT match real fonts/CSS or plain segments", () => {
    expect(
      isDisguisedMediaUrl(
        "https://fonts.gstatic.com/inter/Inter-Regular.woff2",
      ),
    ).toBe(false);
    expect(isDisguisedMediaUrl("https://cdn.provider.io/css/main.css")).toBe(
      false,
    );
    expect(isDisguisedMediaUrl("https://cdn.provider.io/video/movie.mp4")).toBe(
      false,
    );
    expect(isDisguisedMediaUrl("https://cdn.provider.io/manifest.m3u8")).toBe(
      false,
    );
  });
});

describe("mime-sniffer — isVideoResponse (combined verdict)", () => {
  it("trusts a video MIME regardless of URL shape", () => {
    // A disguised extension but a real video MIME → video.
    expect(
      isVideoResponse(
        "https://cdn.provider.io/v4/np/lnhlsj/seg-1-f1-v1.woff2",
        "video/mp2t",
        VIDEO_EXTS,
      ),
    ).toBe(true);
  });

  it("trusts octet-stream when the URL corroborates (disguised segment)", () => {
    expect(
      isVideoResponse(
        "https://cdn.provider.io/x/y/chunk-3-video.png",
        "application/octet-stream",
        VIDEO_EXTS,
      ),
    ).toBe(true);
  });

  it("trusts octet-stream when the URL has an explicit video extension", () => {
    expect(
      isVideoResponse(
        "https://cdn.provider.io/video/seg-1234.ts",
        "application/octet-stream",
        VIDEO_EXTS,
      ),
    ).toBe(true);
  });

  it("does NOT trust octet-stream without a video corroboration", () => {
    expect(
      isVideoResponse(
        "https://cdn.provider.io/update/download.bin",
        "application/octet-stream",
        VIDEO_EXTS,
      ),
    ).toBe(false);
  });

  it("rejects a non-video MIME even with a video-ish URL", () => {
    // A real video server does not label its segments text/html.
    expect(
      isVideoResponse(
        "https://cdn.provider.io/video/seg-1234.ts",
        "text/html; charset=utf-8",
        VIDEO_EXTS,
      ),
    ).toBe(false);
  });

  it("returns false when the MIME is absent (callers keep their own fallbacks)", () => {
    expect(
      isVideoResponse(
        "https://cdn.provider.io/video/seg-1234.ts",
        undefined,
        VIDEO_EXTS,
      ),
    ).toBe(false);
  });
});

// Keep the exported regex honest (no accidental degenerate patterns).
describe("DISGUISED_MEDIA_REGEX integrity", () => {
  it("does not match every URL (index-0 latent bug guard)", () => {
    expect(DISGUISED_MEDIA_REGEX.test("https://evil.example.com/")).toBe(false);
    expect(
      DISGUISED_MEDIA_REGEX.test("https://cdn.provider.io/style.css"),
    ).toBe(false);
  });
});
