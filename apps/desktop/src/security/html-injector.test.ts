import { describe, it, expect, vi, beforeEach } from "vitest";
import { injectProtection, injectCosmetics } from "./html-injector";

// The protection source loader caches its result at module scope. To exercise
// both the "unarmed" (no source) and "armed" paths, each CDP test resets
// modules and re-imports html-injector with a controlled readFileSync.
const fsState = { read: () => "BUNDLE" };
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: (...args: any[]) => {
      const r = fsState.read();
      if (r === "__THROW__") throw new Error("ENOENT");
      return r;
    },
  };
});

async function loadInjector() {
  vi.resetModules();
  return await import("./html-injector");
}

// ── Pure string-level injection ─────────────────────────────────────────────

describe("injectProtection (L8 HTML bytes)", () => {
  const script = "/*PROTECTION_BUNDLE*/";

  it("inlines the script right after <head>", () => {
    const html =
      "<!doctype html><html><head><title>t</title></head><body></body></html>";
    const out = injectProtection(html, script);
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("<title>"));
    expect(out).toContain(script);
    // The script is the first element inside <head>.
    expect(out.indexOf("</head>")).toBeGreaterThan(out.indexOf(script));
  });

  it("handles <head> with attributes", () => {
    const html =
      "<html><head lang='en'><meta charset='utf-8'></head><body></body></html>";
    const out = injectProtection(html, script);
    expect(out).toContain("<head lang='en'><script>");
  });

  it("falls back to after <html> when there is no <head>", () => {
    const html = "<!doctype html><html><body>bare</body></html>";
    const out = injectProtection(html, script);
    expect(out).toMatch(/<html><script>[\s\S]*<body>/);
  });

  it("prepends a bare fragment", () => {
    const html = "no tags at all";
    const out = injectProtection(html, script);
    expect(out.startsWith(`<script>`)).toBe(true);
    expect(out.endsWith(html)).toBe(true);
  });
});

describe("injectCosmetics (L8 HTML bytes)", () => {
  const payload = {
    styles: "body{display:none!important}",
    scripts: ["log('x')"],
  };

  it("inserts style + scriptlet before </head>", () => {
    const html = "<html><head><meta></head><body></body></html>";
    const out = injectCosmetics(html, payload);
    expect(out.indexOf(`<style data-filmsnaps-cosmetic="true">`)).toBeLessThan(
      out.indexOf("</head>"),
    );
    expect(out).toContain(`<script data-filmsnaps-scriptlet="true">`);
  });

  it("falls back to before </body>, then </html>", () => {
    const noHead = "<html><body><p>x</p></body></html>";
    expect(injectCosmetics(noHead, payload)).toContain("</style>");
    const bare = "<html></html>";
    const out = injectCosmetics(bare, payload);
    expect(out).toContain("</style>");
    expect(out.indexOf("</style>")).toBeLessThan(out.indexOf("</html>"));
  });

  it("returns the input unchanged when payload is empty", () => {
    const html = "<html><head></head></html>";
    expect(injectCosmetics(html, { styles: "", scripts: [] })).toBe(html);
  });
});

// ── CDP-Fetch handler (mocked debugger) ─────────────────────────────────────

describe("armFetchHtmlInjection (CDP Fetch domain)", () => {
  beforeEach(() => {
    fsState.read = () => "BUNDLE";
  });

  it("returns undefined (L8 unarmed) when the protection source is unavailable", async () => {
    fsState.read = () => "__THROW__";
    const { armFetchHtmlInjection } = await loadInjector();
    expect(armFetchHtmlInjection(mockDebugger())).toBeUndefined();
  });

  it("continues non-Document resources untouched (fast path)", async () => {
    const { armFetchHtmlInjection } = await loadInjector();
    const dbg = mockDebugger();
    const handler = armFetchHtmlInjection(dbg)!;
    expect(handler).toBeDefined();
    await handler({
      requestId: "r1",
      resourceType: "Script",
      request: { url: "https://cdn.example.com/app.js" },
    });
    expect(dbg.calls).toContainEqual([
      "Fetch.continueRequest",
      { requestId: "r1" },
    ]);
    expect(dbg.calls.some((c) => c[0] === "Fetch.getResponseBody")).toBe(false);
  });

  it("rewrites a paused Document and fulfills with original headers preserved", async () => {
    const { armFetchHtmlInjection } = await loadInjector();
    const dbg = mockDebugger();
    dbg.responses["Fetch.getResponseBody"] = {
      body: Buffer.from(
        "<html><head><title>provider</title></head><body>hi</body></html>",
        "utf-8",
      ).toString("base64"),
      base64Encoded: true,
    };
    const handler = armFetchHtmlInjection(dbg)!;
    await handler({
      requestId: "doc1",
      resourceType: "Document",
      request: { url: "https://provider.com/embed/123" },
      responseStatusCode: 200,
      responseStatusText: "OK",
      responseHeaders: [
        { name: "content-type", value: "text/html; charset=utf-8" },
        { name: "content-encoding", value: "gzip" },
        { name: "set-cookie", value: "session=abc" },
        { name: "Content-Security-Policy", value: "script-src 'self'" },
      ],
    });

    const fulfill = dbg.calls.find((c) => c[0] === "Fetch.fulfillRequest")?.[1];
    expect(fulfill).toBeDefined();
    expect(fulfill.requestId).toBe("doc1");
    expect(fulfill.responseCode).toBe(200);

    const decoded = Buffer.from(fulfill.body, "base64").toString("utf-8");
    expect(decoded).toContain("<script>");
    expect(decoded).toContain("BUNDLE");
    expect(decoded).toContain("<title>provider</title>");

    // Original headers preserved (set-cookie); stripped: encoding/CSP.
    const names = fulfill.responseHeaders.map((h: any) => h.name.toLowerCase());
    expect(names).toContain("set-cookie");
    expect(names).not.toContain("content-encoding");
    expect(names).not.toContain("content-security-policy");
    expect(names).toContain("x-filmsnaps-protection");
  });

  it("fails CLOSED with a 403 when injection throws", async () => {
    const { armFetchHtmlInjection } = await loadInjector();
    const dbg = mockDebugger();
    dbg.failNextGetResponseBody = true;
    const handler = armFetchHtmlInjection(dbg)!;
    await handler({
      requestId: "bad",
      resourceType: "Document",
      request: { url: "https://provider.com/embed/x" },
      responseStatusCode: 200,
      responseStatusText: "OK",
      responseHeaders: [{ name: "content-type", value: "text/html" }],
    });
    const fulfill = dbg.calls.find((c) => c[0] === "Fetch.fulfillRequest")?.[1];
    expect(fulfill?.responseCode).toBe(403);
  });

  it("fulfills with a VALID phrase when responseStatusText is empty/absent (white-page regression)", async () => {
    const { armFetchHtmlInjection } = await loadInjector();
    const dbg = mockDebugger();
    dbg.responses["Fetch.getResponseBody"] = {
      body: Buffer.from(
        "<html><head></head><body>ok</body></html>",
        "utf-8",
      ).toString("base64"),
      base64Encoded: true,
    };
    const handler = armFetchHtmlInjection(dbg)!;

    // responseStatusText: "" — CDP omits it for servers that send no reason
    // phrase. Previously `?? "OK"` kept the empty string, so String("") = ""
    // was passed to fulfillRequest → Chromium rejected the fulfill → fail-closed
    // 403 → the "not protected (blocked)" white page.
    await handler({
      requestId: "empty-phrase",
      resourceType: "Document",
      request: { url: "https://provider.com/embed/1" },
      responseStatusCode: 200,
      responseStatusText: "",
      responseHeaders: [{ name: "content-type", value: "text/html" }],
    });

    const fulfill = dbg.calls.find((c) => c[0] === "Fetch.fulfillRequest")?.[1];
    expect(fulfill).toBeDefined();
    expect(fulfill.responseCode).toBe(200);
    expect(fulfill.responsePhrase).toBe("OK");
    // Must NOT have fallen through to the fail-closed 403 path.
    expect(fulfill.responsePhrase).not.toBe("Forbidden");
  });

  it("uses a VALID phrase on the fail-closed 403 path (Chromium rejects 'Blocked')", async () => {
    const { armFetchHtmlInjection } = await loadInjector();
    const dbg = mockDebugger();
    dbg.failNextGetResponseBody = true;
    const handler = armFetchHtmlInjection(dbg)!;
    await handler({
      requestId: "fail-closed",
      resourceType: "Document",
      request: { url: "https://provider.com/embed/x" },
      responseStatusCode: 200,
      responseStatusText: "",
      responseHeaders: [{ name: "content-type", value: "text/html" }],
    });
    const fulfill = dbg.calls.find((c) => c[0] === "Fetch.fulfillRequest")?.[1];
    expect(fulfill?.responseCode).toBe(403);
    expect(fulfill?.responsePhrase).toBe("Forbidden");
  });

  it("continues non-HTML Documents (JSON/error pages) without buffering", async () => {
    const { armFetchHtmlInjection } = await loadInjector();
    const dbg = mockDebugger();
    const handler = armFetchHtmlInjection(dbg)!;
    await handler({
      requestId: "json",
      resourceType: "Document",
      request: { url: "https://provider.com/api/servers" },
      responseStatusCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
    });
    expect(dbg.calls).toContainEqual([
      "Fetch.continueRequest",
      { requestId: "json" },
    ]);
    expect(dbg.calls.some((c) => c[0] === "Fetch.getResponseBody")).toBe(false);
  });
});

// ── Test doubles ────────────────────────────────────────────────────────────

interface MockDebugger {
  calls: Array<[string, any]>;
  responses: Record<string, any>;
  failNextGetResponseBody: boolean;
  isAttached: () => boolean;
  sendCommand: (cmd: string, params: any) => Promise<any>;
}

function mockDebugger(): MockDebugger {
  const dbg: MockDebugger = {
    calls: [],
    responses: {},
    failNextGetResponseBody: false,
    isAttached: () => true,
    sendCommand: async (cmd: string, params: any) => {
      dbg.calls.push([cmd, params]);
      if (cmd === "Fetch.getResponseBody" && dbg.failNextGetResponseBody) {
        throw new Error("failed to read body");
      }
      return dbg.responses[cmd] ?? {};
    },
  };
  return dbg;
}
