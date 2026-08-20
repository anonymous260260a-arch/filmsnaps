import { describe, it, expect, vi } from "vitest";
import {
  auditProviderSessionWarnings,
  auditPreloadObserverBookkeeping,
  auditMainFramePopUnder,
} from "./structural-warnings";

describe("structural-warnings — auditProviderSessionWarnings (Phase 2e)", () => {
  it("emits a warning when Widevine is enabled on the provider session", () => {
    const warn = vi.fn();
    const count = auditProviderSessionWarnings({
      sessionWidevineEnabled: true,
      providerId: "vidsrc",
      warn,
    });
    expect(count).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/Widevine|widevine/);
  });

  it("emits nothing when Widevine is disabled", () => {
    const warn = vi.fn();
    const count = auditProviderSessionWarnings({
      sessionWidevineEnabled: false,
      warn,
    });
    expect(count).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("structural-warnings — auditPreloadObserverBookkeeping (Phase 2e)", () => {
  it("warns when there are more MutationObservers than .disconnect() calls", () => {
    const warn = vi.fn();
    // cssGuard-style observer that re-injects on every mutation and never
    // disconnects (the leak the heuristic targets).
    const source = `
      const obs = new MutationObserver(() => {});
      obs.observe(document, { childList: true, subtree: true });
    `;
    const count = auditPreloadObserverBookkeeping(source, { warn });
    expect(count).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/MutationObserver|disconnect/);
  });

  it("does not warn when every observer has a matching .disconnect()", () => {
    const warn = vi.fn();
    const source = `
      const obs = new MutationObserver(() => {});
      obs.observe(document, { childList: true });
      obs.disconnect();
    `;
    const count = auditPreloadObserverBookkeeping(source, { warn });
    expect(count).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores empty/missing preload source", () => {
    const warn = vi.fn();
    expect(auditPreloadObserverBookkeeping("", { warn })).toBe(0);
    expect(
      auditPreloadObserverBookkeeping(undefined as unknown as string, { warn }),
    ).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("structural-warnings — auditMainFramePopUnder (Phase 2e)", () => {
  it("warns on a window.open carrying width/height features (pop-under signature)", () => {
    const warn = vi.fn();
    const flagged = auditMainFramePopUnder({
      windowFeatures: "width=400,height=300,top=10,left=10",
      frameUrl: "https://provider.example.com/embed/1",
      warn,
    });
    expect(flagged).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/pop-under|popunder/i);
  });

  it("warns on space-separated feature lists too", () => {
    const warn = vi.fn();
    expect(
      auditMainFramePopUnder({ windowFeatures: "width=640 height=480", warn }),
    ).toBe(true);
  });

  it("does NOT warn on feature-less / noopener-style window.open", () => {
    const warn = vi.fn();
    const flagged = auditMainFramePopUnder({
      windowFeatures: "noopener,noreferrer",
      frameUrl: "https://provider.example.com",
      warn,
    });
    expect(flagged).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does NOT warn on empty features (regular target=_blank popups)", () => {
    const warn = vi.fn();
    expect(auditMainFramePopUnder({ windowFeatures: "", warn })).toBe(false);
    expect(
      auditMainFramePopUnder({ frameUrl: "https://x.example.com", warn }),
    ).toBe(false);
  });

  it("defaults warn to console.warn when not provided", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      auditMainFramePopUnder({ windowFeatures: "width=400,height=300" });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
