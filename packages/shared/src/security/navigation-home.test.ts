import { describe, it, expect } from "vitest";
import {
  isHomeEscape,
  isUniversalHomeEscape,
  looksHomeLikeWithoutId,
  type NavigationGuardConfig,
} from "./navigation-home";

const DEFAULT_CFG: NavigationGuardConfig = {
  universalBlockPaths: ["/"],
  blockHomePaths: ["/", "/movies", "/home", "/trending"],
  shallowDepthThreshold: 1,
};

describe("isHomeEscape — provider home-page escape guard", () => {
  it("allows the exact requested embed path (same-path error page stays unblocked)", () => {
    expect(
      isHomeEscape(
        "https://screenscape.me/embed?tmdb=1234&type=movie",
        "https://screenscape.me/embed?tmdb=1234&type=movie",
        DEFAULT_CFG,
      ),
    ).toBe(false);
  });

  it("allows a sub-navigation under the embed path (episode/quality switch)", () => {
    expect(
      isHomeEscape(
        "https://nxsha.app/embed/tv/12345/1/2",
        "https://nxsha.app/embed/tv/12345/1/1",
        DEFAULT_CFG,
      ),
    ).toBe(false);
  });

  it("blocks the bare root — universal, no per-provider config required", () => {
    expect(
      isHomeEscape(
        "https://screenscape.me/",
        "https://screenscape.me/embed?tmdb=1234&type=movie",
        DEFAULT_CFG,
      ),
    ).toBe(true);
    expect(
      isHomeEscape(
        "https://nxsha.app",
        "https://nxsha.app/embed/movie/12345",
        DEFAULT_CFG,
      ),
    ).toBe(true);
  });

  it("blocks home '/' when the embed is query-only at the SAME '/' path (screenscape-style bare-path embed)", () => {
    // The embed is `screenscape.me/?tmdb=1234&type=movie` — pathname "/" with a
    // query. Home is `screenscape.me/` — pathname "/" with NO query. Path-only
    // comparison makes them identical, so the HARD-ALLOW let home through. The
    // fix compares path + query, so they differ and the universal "/" block fires.
    expect(
      isHomeEscape(
        "https://screenscape.me/",
        "https://screenscape.me/?tmdb=1234&type=movie",
        DEFAULT_CFG,
      ),
    ).toBe(true);
  });

  it("allows legit episode-nav on a query-only embed (same '/' path, still carries tmdb id)", () => {
    expect(
      isHomeEscape(
        "https://screenscape.me/?tmdb=1234&type=tv&s=1&e=2",
        "https://screenscape.me/?tmdb=1234&type=tv&s=1&e=1",
        DEFAULT_CFG,
      ),
    ).toBe(false);
  });

  it("blocks a per-provider listed home path", () => {
    expect(
      isHomeEscape(
        "https://screenscape.me/home",
        "https://screenscape.me/embed?tmdb=1234&type=movie",
        DEFAULT_CFG,
      ),
    ).toBe(true);
    expect(
      isHomeEscape(
        "https://screenscape.me/trending/",
        "https://screenscape.me/embed?tmdb=1234&type=movie",
        DEFAULT_CFG,
      ),
    ).toBe(true);
  });

  it("allows an unlisted same-host path that is not a home shape", () => {
    expect(
      isHomeEscape(
        "https://screenscape.me/some-other-page",
        "https://screenscape.me/embed?tmdb=1234&type=movie",
        { ...DEFAULT_CFG, blockHomePaths: ["/", "/home"] },
      ),
    ).toBe(false);
  });

  it("handles empty provider blockHomePaths with the universal root still active", () => {
    expect(
      isHomeEscape(
        "https://nhdapi.com/",
        "https://nhdapi.com/embed/movie/12345",
        {
          universalBlockPaths: ["/"],
          blockHomePaths: [],
          shallowDepthThreshold: 1,
        },
      ),
    ).toBe(true);
  });
});

describe("isUniversalHomeEscape", () => {
  it("blocks bare root against a single-entry universal list", () => {
    expect(isUniversalHomeEscape("/", ["/"])).toBe(true);
    expect(isUniversalHomeEscape("", ["/"])).toBe(false);
  });
});

describe("looksHomeLikeWithoutId", () => {
  it("flags a numeric-id embed redirected to an id-less path", () => {
    expect(
      looksHomeLikeWithoutId(
        "https://provider.com/",
        "https://provider.com/embed/movie/1234",
      ),
    ).toBe(true);
  });

  it("accepts a target that still carries a numeric id (sub-path)", () => {
    expect(
      looksHomeLikeWithoutId(
        "https://provider.com/embed/tv/1234/1/2",
        "https://provider.com/embed/tv/1234/1/1",
      ),
    ).toBe(false);
  });

  it("returns false when the embed itself has no numeric id signal", () => {
    expect(
      looksHomeLikeWithoutId(
        "https://screenscape.me/home",
        "https://screenscape.me/foo",
      ),
    ).toBe(false);
  });
});
