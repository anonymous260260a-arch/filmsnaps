import { describe, it, expect, vi, afterEach } from "vitest";
import { SessionTrustManager } from "./session-trust";

// SessionTrustManager is electron-free (pure ts). No mocks needed.
// MIME verification comes from mime-sniffer; these tests pin the Phase 2c
// behavior: MIME is the authority, octet-stream corroborates, TTL is 15min.

describe("SessionTrustManager — Phase 2c MIME authority", () => {
  const TS_URL = "https://cdn.example.com/video/seg-1234.ts";
  const WOFF_URL = "https://cdn.example.com/v4/np/lnhlsj/seg-1-f1-v1.woff2";

  it("trusts a host that serves a video/* Content-Type", () => {
    const tm = new SessionTrustManager();
    expect(tm.checkVideoContent(TS_URL, "cdn.example.com", "video/mp2t")).toBe(
      true,
    );
    expect(tm.size).toBe(1);
    // The host is now trusted for media-type requests.
    expect(
      tm.isTrustedFor(
        "https://cdn.example.com/video/seg-1235.ts",
        "cdn.example.com",
        "fetch",
      ),
    ).toBe(true);
  });

  it("refuses trust when a non-video MIME labels a video-ish URL", () => {
    const tm = new SessionTrustManager();
    // text/html + a .ts URL → NOT trusted (a real video server wouldn't).
    expect(tm.checkVideoContent(TS_URL, "cdn.example.com", "text/html")).toBe(
      false,
    );
    expect(tm.size).toBe(0);
  });

  it("trusts octet-stream for a disguised HLS segment (MIME corroborates shape)", () => {
    const tm = new SessionTrustManager();
    expect(
      tm.checkVideoContent(
        WOFF_URL,
        "cdn.example.com",
        "application/octet-stream",
      ),
    ).toBe(true);
    expect(tm.size).toBe(1);
  });

  it("does NOT trust octet-stream for a generic download", () => {
    const tm = new SessionTrustManager();
    expect(
      tm.checkVideoContent(
        "https://cdn.example.com/update/pkg.bin",
        "cdn.example.com",
        "application/octet-stream",
      ),
    ).toBe(false);
    expect(tm.size).toBe(0);
  });

  it("falls back to the disguised-URL hint when MIME is absent", () => {
    const tm = new SessionTrustManager();
    expect(tm.checkVideoContent(WOFF_URL, "cdn.example.com", undefined)).toBe(
      true,
    );
    expect(tm.size).toBe(1);
  });

  it("falls back to the explicit-extension hint when MIME is absent", () => {
    const tm = new SessionTrustManager();
    expect(tm.checkVideoContent(TS_URL, "cdn.example.com", undefined)).toBe(
      true,
    );
    expect(tm.size).toBe(1);
  });
});

describe("SessionTrustManager — TTL (Phase 2c: 15min configurable)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps trust alive past the old 60s when using the default 15min TTL", () => {
    vi.useFakeTimers();
    const tm = new SessionTrustManager();
    tm.checkVideoContent(
      "https://cdn.example.com/video/movie.mp4",
      "cdn.example.com",
      "video/mp4",
    );
    // 90 seconds later — OLD behavior (60s) would have expired this.
    vi.advanceTimersByTime(90_000);
    expect(
      tm.isTrustedFor(
        "https://cdn.example.com/video/next.m3u8",
        "cdn.example.com",
        "media",
      ),
    ).toBe(true);
  });

  it("expires trust after the configured TTL elapses", () => {
    vi.useFakeTimers();
    const tm = new SessionTrustManager({ trustTTLMs: 5_000 });
    tm.checkVideoContent(
      "https://cdn.example.com/video/movie.mp4",
      "cdn.example.com",
      "video/mp4",
    );
    vi.advanceTimersByTime(4_000);
    expect(
      tm.isTrustedFor(
        "https://cdn.example.com/video/next.m3u8",
        "cdn.example.com",
        "media",
      ),
    ).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(
      tm.isTrustedFor(
        "https://cdn.example.com/video/next.m3u8",
        "cdn.example.com",
        "media",
      ),
    ).toBe(false);
  });

  it("rejects a non-positive configured TTL and falls back to the default", () => {
    vi.useFakeTimers();
    const tm = new SessionTrustManager({ trustTTLMs: 0 });
    tm.checkVideoContent(
      "https://cdn.example.com/video/movie.mp4",
      "cdn.example.com",
      "video/mp4",
    );
    // Default (15min) still holds.
    vi.advanceTimersByTime(60_000);
    expect(
      tm.isTrustedFor(
        "https://cdn.example.com/video/next.m3u8",
        "cdn.example.com",
        "media",
      ),
    ).toBe(true);
  });
});
