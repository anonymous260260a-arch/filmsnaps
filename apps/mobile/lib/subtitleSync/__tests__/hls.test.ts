import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// probeHls uses getProbeAdapter() (defaults to a lazy require of the native
// bridge). Inject a mock adapter so the native module never loads.
const { probeMock } = vi.hoisted(() => ({ probeMock: vi.fn() }));

import {
  clearProbeCache,
  canAutoSync,
  probeHls,
  setProbeAdapter,
  windowPlan,
} from "../source";
import type { SourceRef } from "../source";

function makeHlsSource(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    contentId: "hls-999",
    kind: "hls",
    container: "other",
    resolve: async () => ({
      uri: "https://cdn.example.com/stream.m3u8",
      headers: { Authorization: "***" },
    }),
    ...overrides,
  };
}

function probeResult(
  overrides: Partial<{
    live: boolean;
    drmProtected: boolean;
    muxedOnly: boolean;
  }> = {},
) {
  return {
    ok: true,
    live: false,
    drmProtected: false,
    muxedOnly: false,
    ...overrides,
  };
}

beforeEach(() => {
  probeMock.mockReset();
  clearProbeCache();
  setProbeAdapter(probeMock);
});

afterEach(() => {
  setProbeAdapter(null);
});

describe("hls auto sync", () => {
  // ——— canAutoSync gate ———
  it("allows a VOD, non-DRM HLS stream", async () => {
    probeMock.mockResolvedValue(probeResult());
    const r = await canAutoSync(makeHlsSource(), "android");
    expect(r).toEqual({ ok: true });
  });

  it("rejects live HLS with reason live", async () => {
    probeMock.mockResolvedValue(probeResult({ live: true }));
    const r = await canAutoSync(makeHlsSource(), "android");
    expect(r).toEqual({ ok: false, reason: "live" });
  });

  it("rejects DRM-protected HLS with reason drm", async () => {
    probeMock.mockResolvedValue(probeResult({ drmProtected: true }));
    const r = await canAutoSync(makeHlsSource(), "android");
    expect(r).toEqual({ ok: false, reason: "drm" });
  });

  it("rejects a probe failure with reason probe-fail", async () => {
    probeMock.mockResolvedValue({
      ok: false,
      code: "expired-url",
      message: "nope",
    });
    const r = await canAutoSync(makeHlsSource(), "android");
    expect(r).toEqual({ ok: false, reason: "probe-fail" });
  });

  it("probe throws are also gated as probe-fail", async () => {
    probeMock.mockRejectedValue(new Error("boom"));
    const r = await canAutoSync(makeHlsSource(), "android");
    expect(r).toEqual({ ok: false, reason: "probe-fail" });
  });

  // ——— probeHls caching ———
  it("caches the probe by contentId", async () => {
    probeMock.mockResolvedValue(probeResult());
    const src = makeHlsSource();
    await probeHls(src);
    await probeHls(src); // cached - probeAsync called exactly once
    await canAutoSync(src, "ios"); // hits the same cache
    expect(probeMock).toHaveBeenCalledTimes(1);
  });

  it("clearProbeCache forces a re-probe", async () => {
    probeMock.mockResolvedValue(probeResult());
    const src = makeHlsSource();
    await probeHls(src);
    clearProbeCache();
    await probeHls(src);
    expect(probeMock).toHaveBeenCalledTimes(2);
  });

  // ——— windowPlan for HLS (speed model: 4x cap, tight windows) ———
  it("muxed-only playlist gets 240/120 at speed 3", async () => {
    probeMock.mockResolvedValue(probeResult({ muxedOnly: true }));
    const w = await windowPlan(makeHlsSource(), "wifi");
    expect(w).toEqual({ earlySec: 240, lateSec: 120, speed: 3 });
  });

  it("separate-audio HLS gets 300/180 at speed 4 on wifi", async () => {
    probeMock.mockResolvedValue(probeResult());
    const w = await windowPlan(makeHlsSource(), "wifi");
    expect(w).toEqual({ earlySec: 300, lateSec: 180, speed: 4 });
  });

  it("separate-audio HLS keeps speed 4 on cellular (segment fetch, not bitrate-bound)", async () => {
    probeMock.mockResolvedValue(probeResult());
    const w = await windowPlan(makeHlsSource(), "cellular");
    expect(w).toEqual({ earlySec: 300, lateSec: 180, speed: 4 });
  });

  it("probe failure falls back to the non-muxed plan", async () => {
    probeMock.mockRejectedValue(new Error("network"));
    const w = await windowPlan(makeHlsSource(), "wifi");
    expect(w).toEqual({ earlySec: 300, lateSec: 180, speed: 4 });
  });
});
