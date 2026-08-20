import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `navigation-guard` imports BrowserWindow/WebContents from electron. Only the
// WebContents event surface is exercised here, so mock electron minimally.
vi.mock("electron", () => ({
  BrowserWindow: class {},
}));

import { applyNavigationGuard, isHomeEscapeCjs } from "./navigation-guard";

// ── Minimal EventEmitter-like WebContents double ────────────────────────────
// applyNavigationGuard registers `.on("will-navigate"|"will-redirect"|
// "did-finish-load"|"did-navigate"|"destroyed")` and `setWindowOpenHandler`,
// `loadURL`. Emitting is a plain function-call test harness.

type Handler = (...args: any[]) => void;

function makeWebContents() {
  const handlers = new Map<string, Handler[]>();
  const wc: any = {
    on: (ev: string, h: Handler) => {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev)!.push(h);
    },
    once: (ev: string, h: Handler) => wc.on(ev, h),
    emit: (ev: string, ...args: any[]) => {
      for (const h of handlers.get(ev) ?? []) h(...args);
    },
    setWindowOpenHandler: vi.fn(() => ({ action: "deny" })),
    loadURL: vi.fn(),
    isDestroyed: () => false,
  };
  return { wc, handlers };
}

/** A will-redirect event object with a preventDefault spy. */
function makeEvent() {
  return { preventDefault: vi.fn() };
}

/**
 * Advance past the 5s bootstrap window so new hosts are NOT auto-added.
 * The bootstrap timer is the only setTimeout applyNavigationGuard starts.
 */
function endBootstrap(_handlers: Map<string, Handler[]>) {
  vi.advanceTimersByTime(5001);
}

// ── applyNavigationGuard server-redirect ────────────────────────────────────

describe("applyNavigationGuard — allowServerRedirects (Phase 2b)", () => {
  let f: ReturnType<typeof makeWebContents>;

  beforeEach(() => {
    f = makeWebContents();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows + whitelists a main-frame server redirect when allowServerRedirects", () => {
    const { wc, handlers } = f;
    applyNavigationGuard(wc, {
      providerUrl: "https://vidsrc.wtf/api/1/movie/?id=123",
      allowServerRedirects: true,
    });

    // The provider's own server redirect: vidsrc.wtf → viduki.net (main frame).
    const ev = makeEvent();
    handlers.get("will-redirect")![0](
      ev,
      "https://viduki.net/embed/movie/123",
      false, // isInPlace
      true, // isMainFrame
    );

    // Allowed (no preventDefault) even AFTER bootstrap ended.
    endBootstrap(handlers);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("still blocks the redirect when allowServerRedirects is false (after bootstrap)", () => {
    const { wc, handlers } = f;
    applyNavigationGuard(wc, {
      providerUrl: "https://vidsrc.wtf/api/1/movie/?id=123",
      allowServerRedirects: false,
    });

    endBootstrap(handlers);
    const ev = makeEvent();
    handlers.get("will-redirect")![0](
      ev,
      "https://viduki.net/embed/movie/123",
      false,
      true,
    );
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it("does NOT let a subframe redirect escape to a mesh host", () => {
    const { wc, handlers } = f;
    applyNavigationGuard(wc, {
      providerUrl: "https://vidsrc.wtf/api/1/movie/?id=123",
      allowServerRedirects: true,
    });

    endBootstrap(handlers);
    // A non-main-frame redirect away from the embed → still blocked.
    const ev = makeEvent();
    handlers.get("will-redirect")![0](
      ev,
      "https://ads.example.com/pop.js",
      false,
      false, // NOT main frame
    );
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it("does not whitelist a random host via a subframe redirect", () => {
    const { wc, handlers } = f;
    applyNavigationGuard(wc, {
      providerUrl: "https://vidsrc.wtf/api/1/movie/?id=123",
      allowServerRedirects: true,
    });

    endBootstrap(handlers);
    const ev = makeEvent();
    handlers.get("will-redirect")![0](
      ev,
      "https://evil.tracker.net/beacon",
      false,
      false,
    );
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});

// ── updateConfig (Phase 3 — persistent WebContentsView provider switch) ─────

describe("applyNavigationGuard — updateConfig (Phase 3 provider switch)", () => {
  let f: ReturnType<typeof makeWebContents>;

  beforeEach(() => {
    f = makeWebContents();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-points the guard to a new provider URL/host via updateConfig", () => {
    const { wc, handlers } = f;
    const g = applyNavigationGuard(wc, {
      providerUrl: "https://vidsrc.wtf/api/1/movie/?id=123",
      allowServerRedirects: false,
    });
    endBootstrap(handlers);

    // Switch to a DIFFERENT provider on the SAME persistent view.
    g.updateConfig({
      providerUrl: "https://videasy.net/e/abc",
      allowServerRedirects: true,
    });

    // After updateConfig, a main-frame server redirect for the NEW provider
    // (videasy → videasy.to) is allowed + whitelisted.
    const ev = makeEvent();
    handlers.get("will-redirect")![0](
      ev,
      "https://videasy.to/player/abc",
      false,
      true,
    );
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("applies the new allowServerRedirects=false after a switch (blocks mesh host)", () => {
    const { wc, handlers } = f;
    const g = applyNavigationGuard(wc, {
      providerUrl: "https://vidsrc.wtf/api/1/movie/?id=123",
      allowServerRedirects: true,
    });
    endBootstrap(handlers);

    // Switch to a provider WITHOUT the mesh flag.
    g.updateConfig({
      providerUrl: "https://nxsha.su/e/abc",
      allowServerRedirects: false,
    });

    const ev = makeEvent();
    handlers.get("will-redirect")![0](
      ev,
      "https://evil.tracker.net/beacon",
      false,
      true,
    );
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it("merges new additionalAllowedHosts into the persistent whitelist", () => {
    const { wc, handlers } = f;
    const g = applyNavigationGuard(wc, {
      providerUrl: "https://vidsrc.wtf/api/1/movie/?id=123",
    });
    endBootstrap(handlers);

    g.updateConfig({
      providerUrl: "https://nxsha.su/e/abc",
      additionalAllowedHosts: ["cdn.nxsha.su"],
    });

    // A navigation to the newly-added CDN host is now allowed.
    const ev = makeEvent();
    handlers.get("will-navigate")![0](
      ev,
      "https://cdn.nxsha.su/video/seg-1.ts",
    );
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("routes onBlocked/onEscaped to the latest callbacks after updateConfig", () => {
    const { wc, handlers } = f;
    const onBlocked1 = vi.fn();
    const onBlocked2 = vi.fn();
    const g = applyNavigationGuard(wc, {
      providerUrl: "https://vidsrc.wtf/api/1/movie/?id=123",
      onBlocked: onBlocked1,
    });
    endBootstrap(handlers);

    g.updateConfig({
      providerUrl: "https://nxsha.su/e/abc",
      onBlocked: onBlocked2,
    });

    const ev = makeEvent();
    handlers.get("will-navigate")![0](ev, "https://evil.tracker.net/beacon");
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(onBlocked1).not.toHaveBeenCalled();
    expect(onBlocked2).toHaveBeenCalled();
  });
});

// ── Home-escape guard regression ────────────────────────────────────────────

describe("isHomeEscapeCjs", () => {
  const EMPTY: string[] = [];

  it("allows the exact embed URL", () => {
    expect(
      isHomeEscapeCjs(
        "https://vidsrc.wtf/api/1/movie/?id=123",
        "https://vidsrc.wtf/api/1/movie/?id=123",
        EMPTY,
        ["/"],
      ),
    ).toBe(false);
  });

  it("blocks a universal bare-root home escape", () => {
    expect(
      isHomeEscapeCjs(
        "https://vidsrc.wtf/",
        "https://vidsrc.wtf/api/1/movie/?id=123",
        EMPTY,
        ["/"],
      ),
    ).toBe(true);
  });

  it("allows a same-path sub-route that still carries the media id", () => {
    // /api/1/movie/123 is a numeric-media-id route under the embed → allowed.
    expect(
      isHomeEscapeCjs(
        "https://vidsrc.wtf/api/1/movie/123?x=1",
        "https://vidsrc.wtf/api/1/movie/?id=123",
        EMPTY,
        ["/"],
      ),
    ).toBe(false);
  });

  it("blocks a per-provider blockHomePath", () => {
    expect(
      isHomeEscapeCjs(
        "https://vidsrc.wtf/home",
        "https://vidsrc.wtf/api/1/movie/?id=123",
        ["/home"],
        ["/"],
      ),
    ).toBe(true);
  });
});
