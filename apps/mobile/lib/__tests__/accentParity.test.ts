/**
 * v10 parity gate — Accent Lab export vs apps/mobile/lib/accentCore.ts.
 *
 * The fixture (accent-lab-v10-export.json) was exported from the browser
 * lab whose CORE block accentCore.ts ports verbatim. For every title:
 *   - pickAccent(swatches).hex  === picked.hex   (exact)
 *   - pickAccent(...).score      ≈  picked.score  (same math)
 *   - paintAccent(picked.hex)    reproduces painted.accent / .text / .zone
 *     (exact hex strings)
 * A single hex mismatch fails the build — these are parity gates, not
 * style checks.
 */
import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/accent-lab-v10-export.json";
import { paintAccent, pickAccent, type PaintSuccess } from "../accentCore";

describe("v10 parity vs lab export (bit-exact)", () => {
  it("fixture has the expected shape", () => {
    expect(fixtures).toHaveLength(20);
  });

  for (const entry of fixtures) {
    it(`pick+paint: ${entry.title}`, () => {
      const picked = pickAccent(entry.swatches);
      expect(
        picked,
        `pickAccent returned null for ${entry.title}`,
      ).not.toBeNull();
      expect(picked!.hex).toBe(entry.picked.hex);
      expect(picked!.score).toBeCloseTo(entry.picked.score, 6);

      const painted = paintAccent(picked!.hex);
      expect(
        painted,
        `paintAccent failed for ${entry.title}: ${JSON.stringify(painted)}`,
      ).not.toHaveProperty("fail");
      const p = painted as PaintSuccess;
      expect(p.accent).toBe(entry.painted.accent);
      expect(p.text).toBe(entry.painted.text);
      expect(p.zone).toBe(entry.painted.zone);
    });
  }
});
