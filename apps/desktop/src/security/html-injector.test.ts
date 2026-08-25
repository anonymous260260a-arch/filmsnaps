import { describe, it, expect } from "vitest";
import { injectCosmetics } from "./html-injector";

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
