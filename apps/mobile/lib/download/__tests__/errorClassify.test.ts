import { describe, it, expect } from "vitest";
import {
  classifyDownloadError,
  extractHttpStatus,
  InsufficientSpaceError,
} from "../errorClassify";

describe("classifyDownloadError", () => {
  it("treats expired/dead upstream links as permanent with an actionable message", () => {
    for (const code of [403, 404, 410, 451]) {
      const c = classifyDownloadError(new Error(`HTTP ${code}`));
      expect(c.permanent).toBe(true);
      expect(c.kind).toBe("expired");
      expect(c.userMessage).toMatch(/pick another stream/i);
    }
  });

  it("treats disk-full (ENOSPC) as permanent storage failure", () => {
    const variants = [
      "write failed: ENOSPC (No space left on device)",
      "No space left on device",
      "out of storage space",
      "disk quota exceeded",
    ];
    for (const m of variants) {
      const c = classifyDownloadError(new Error(m));
      expect(c.permanent).toBe(true);
      expect(c.kind).toBe("storage");
      expect(c.userMessage).toMatch(/free up/i);
    }
  });

  it("keeps 5xx / 408 / 429 transient (backoff retry applies)", () => {
    for (const code of [500, 502, 503, 408, 429]) {
      const c = classifyDownloadError(new Error(`HTTP ${code}`));
      expect(c.permanent).toBe(false);
      expect(c.kind).toBe("http");
    }
  });

  it("keeps network-level failures transient", () => {
    const variants = [
      "Download interrupted: network error",
      "timeout",
      "Failed to connect to server",
      "Unable to resolve host",
    ];
    for (const m of variants) {
      const c = classifyDownloadError(new Error(m));
      expect(c.permanent).toBe(false);
      expect(c.kind).toBe("network");
    }
  });

  it("classifies incomplete transfers as transient", () => {
    const c = classifyDownloadError(
      new Error("Incomplete download: 500/1000 bytes"),
    );
    expect(c.permanent).toBe(false);
    expect(c.kind).toBe("incomplete");
  });

  it("treats other 4xx statuses as permanent rejections", () => {
    const c = classifyDownloadError(new Error("HTTP 401"));
    expect(c.permanent).toBe(true);
    expect(c.kind).toBe("http");
  });

  it("falls back to a generic retryable unknown class", () => {
    const c = classifyDownloadError(new Error("something weird"));
    expect(c.permanent).toBe(false);
    expect(c.kind).toBe("unknown");
    expect(c.userMessage.length).toBeGreaterThan(0);
  });

  it("handles non-Error inputs without throwing", () => {
    expect(() => classifyDownloadError(undefined)).not.toThrow();
    expect(() => classifyDownloadError(42)).not.toThrow();
    expect(classifyDownloadError("HTTP 410").permanent).toBe(true);
  });
});

describe("extractHttpStatus", () => {
  it("extracts codes from native-style messages", () => {
    expect(extractHttpStatus("HTTP 403")).toBe(403);
    expect(extractHttpStatus("status: 502 bad gateway")).toBe(502);
    expect(extractHttpStatus("Server returned HTTP 410")).toBe(410);
  });

  it("ignores non-status numbers and non-4xx/5xx codes", () => {
    expect(extractHttpStatus("HTTP 200")).toBeNull();
    expect(extractHttpStatus("error 123 at line 4")).toBeNull();
    expect(extractHttpStatus("no numbers of interest")).toBeNull();
  });
});

describe("InsufficientSpaceError", () => {
  it("carries free/needed bytes for the warn dialog", () => {
    const e = new InsufficientSpaceError(20 * 1024 ** 3, 80 * 1024 ** 3);
    expect(e.name).toBe("InsufficientSpaceError");
    expect(e.freeBytes).toBe(20 * 1024 ** 3);
    expect(e.neededBytes).toBe(80 * 1024 ** 3);
  });
});
