import { describe, it, expect } from "vitest";
import {
  canAutoSync,
  isHlsOrDash,
  windowPlan,
  detectKind,
  type SourceRef,
} from "../source";

function makeSource(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    contentId: "test-123",
    kind: "remote",
    container: "mp4",
    resolve: async () => ({ uri: "https://example.com/video.mp4" }),
    ...overrides,
  };
}

describe("source", () => {
  // ——— detectKind ———
  it("detectKind: local file", () => {
    expect(detectKind("file:///sdcard/movie.mkv")).toBe("local");
  });

  it("detectKind: remote progressive", () => {
    expect(detectKind("https://cdn.example.com/video.mp4")).toBe("remote");
  });

  it("detectKind: m3u8 by path/query", () => {
    expect(detectKind("https://cdn.example.com/stream.m3u8")).toBe("hls");
    expect(detectKind("https://cdn.example.com/STREAM.M3U8?token=x")).toBe(
      "hls",
    );
  });

  it("detectKind: m3u8 by content-type (no extension)", () => {
    expect(
      detectKind("https://cdn.example.com/v/7k2", "application/x-mpegURL"),
    ).toBe("hls");
    expect(
      detectKind(
        "https://cdn.example.com/v/7k2",
        "application/vnd.apple.mpegurl",
      ),
    ).toBe("hls");
  });

  it("detectKind: m3u8 ignored for local extensionless file", () => {
    expect(detectKind("/storage/movie.ts", undefined)).toBe("local");
  });

  // ——— isHlsOrDash ———
  it("detects HLS", () => {
    expect(isHlsOrDash("https://cdn.example.com/stream.m3u8")).toBe(true);
    expect(isHlsOrDash("https://cdn.example.com/STREAM.M3U8?token=x")).toBe(
      true,
    );
  });

  it("detects DASH", () => {
    expect(isHlsOrDash("https://cdn.example.com/stream.mpd")).toBe(true);
  });

  it("rejects progressive", () => {
    expect(isHlsOrDash("https://cdn.example.com/video.mp4")).toBe(false);
    expect(isHlsOrDash("https://cdn.example.com/video.mkv")).toBe(false);
  });

  // ——— canAutoSync ———
  it("allows local mp4 on both platforms", async () => {
    const src = makeSource({ kind: "local", container: "mp4" });
    expect((await canAutoSync(src, "android")).ok).toBe(true);
    expect((await canAutoSync(src, "ios")).ok).toBe(true);
  });

  it("allows remote mp4", async () => {
    expect((await canAutoSync(makeSource(), "android")).ok).toBe(true);
    expect((await canAutoSync(makeSource(), "ios")).ok).toBe(true);
  });

  it("allows remote mkv on android", async () => {
    expect(
      (await canAutoSync(makeSource({ container: "mkv" }), "android")).ok,
    ).toBe(true);
  });

  it("rejects mkv on ios", async () => {
    const result = await canAutoSync(makeSource({ container: "mkv" }), "ios");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("mkv-ios");
  });

  it("rejects webm on ios", async () => {
    const result = await canAutoSync(makeSource({ container: "webm" }), "ios");
    expect(result.ok).toBe(false);
  });

  // ——— windowPlan (speed model: 4x remote cap, tight windows) ———
  it("local gets large windows and speed 1", async () => {
    const src = makeSource({ kind: "local" });
    const w = await windowPlan(src, "wifi");
    expect(w.earlySec).toBe(900);
    expect(w.lateSec).toBe(480);
    expect(w.speed).toBe(1);
  });

  it("remote progressive gets 180s early at speed 4 (android cap)", async () => {
    const w = await windowPlan(makeSource(), "wifi");
    expect(w.earlySec).toBe(180);
    expect(w.lateSec).toBe(120);
    expect(w.speed).toBe(4);
  });

  it("remote progressive cellular gets the same tight plan", async () => {
    const w = await windowPlan(makeSource(), "cellular");
    expect(w.earlySec).toBe(180);
    expect(w.speed).toBe(4);
  });

  it("remote mkv gets 180s early (sequential read, 4x)", async () => {
    expect(
      (await windowPlan(makeSource({ container: "mkv" }), "wifi")).earlySec,
    ).toBe(180);
    expect(
      (await windowPlan(makeSource({ container: "mkv" }), "wifi")).speed,
    ).toBe(4);
  });

  it("remote webm gets 180s early (sequential read, 4x)", async () => {
    const w = await windowPlan(makeSource({ container: "webm" }), "wifi");
    expect(w.earlySec).toBe(180);
    expect(w.speed).toBe(4);
  });
});
