import { describe, expect, it } from "vitest";
import { containsAbuse } from "./abuse-words";

describe("containsAbuse", () => {
  it("flags plain abuse words", () => {
    expect(containsAbuse("this app is shit")).toBe(true);
    expect(containsAbuse("fuck you")).toBe(true);
  });

  it("flags leetspeak and separator tricks", () => {
    expect(containsAbuse("sh1t")).toBe(true);
    expect(containsAbuse("f.u.c.k")).toBe(true);
    expect(containsAbuse("FUCK")).toBe(true);
    expect(containsAbuse("b!tch")).toBe(true);
    expect(containsAbuse("4sshole")).toBe(true);
  });

  it("does not flag innocent words containing patterns mid-word", () => {
    expect(containsAbuse("let me assess this grape situation")).toBe(false);
    expect(containsAbuse("classic analytics class")).toBe(false);
    expect(containsAbuse("the keyword is highlight")).toBe(false);
  });

  it("passes normal feedback through", () => {
    expect(containsAbuse("The player keeps buffering on my phone")).toBe(false);
    expect(containsAbuse("Would love a watchlist import feature")).toBe(false);
    expect(containsAbuse("")).toBe(false);
  });
});
