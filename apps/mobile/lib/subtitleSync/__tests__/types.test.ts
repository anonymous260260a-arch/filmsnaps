import { describe, it, expect } from "vitest";
import { validateSignal } from "../types";

function makeSignalB64(
  bins: number,
  pattern: "full" | "empty" | "sparse",
): string {
  const bytes = Math.ceil(bins / 8);
  const data = new Uint8Array(bytes);
  if (pattern === "full") {
    data.fill(0xff);
  } else if (pattern === "sparse") {
    for (let i = 0; i < bins; i += 100) data[i >> 3] |= 1 << (i & 7);
  }
  // empty → all zeros (default)
  return btoa(String.fromCharCode(...data));
}

describe("validateSignal", () => {
  it("accepts a valid signal", () => {
    const bins = 1000;
    const sig = validateSignal({
      rate: 100,
      startSec: 0,
      endSec: 10,
      bins,
      signalB64: makeSignalB64(bins, "sparse"),
    });
    expect(sig.rate).toBe(100);
    expect(sig.bins).toBe(bins);
    expect(sig.data.length).toBe(bins);
  });

  it("rejects non-100Hz rate", () => {
    expect(() =>
      validateSignal({
        rate: 50,
        startSec: 0,
        endSec: 10,
        bins: 1000,
        signalB64: makeSignalB64(1000, "full"),
      }),
    ).toThrow("unexpected rate 50");
  });

  it("handles ±1 byte tolerance in signalB64", () => {
    // bins=10 → needs ceil(10/8)=2 bytes. Provide 1 byte → should still work with tolerance.
    const oneByte = btoa("\xff");
    const sig = validateSignal({
      rate: 100,
      startSec: 0,
      endSec: 0.1,
      bins: 10,
      signalB64: oneByte,
    });
    expect(sig.bins).toBe(10);
  });

  it("pads a short signalB64 (BitSet silent-tail trim) instead of rejecting", () => {
    // 240.45 s @ 100 Hz = 24045 bins → expected ceil(24045/8)=3006 bytes.
    // Native BitSet.toByteArray() trims trailing zero bytes, so a window ending
    // in silence ships e.g. 3000 bytes. Validator must pad, not reject, and
    // must keep bins == data.length so findOffset bounds still hold.
    const bins = 24045;
    const trimmedTo = 3000;
    const bytes = new Uint8Array(trimmedTo);
    for (let i = 0; i < 6000; i++) bytes[i >> 3] |= 1 << (i & 7); // speech early
    const sig = validateSignal({
      rate: 100,
      startSec: 59.5,
      endSec: 300.0,
      bins,
      signalB64: btoa(String.fromCharCode(...bytes)),
    });
    expect(sig.bins).toBe(bins);
    expect(sig.data.length).toBe(bins); // canonical length invariant
    // Bits beyond the trimmed region are all zero (silent tail) — never garbage.
    for (let i = 6000; i < 24000; i++) expect(sig.data[i]).toBe(0);
  });

  it("still rejects a signalB64 that is too long", () => {
    const bins = 24045;
    const tooLong = new Uint8Array(3010).fill(0xff);
    expect(() =>
      validateSignal({
        rate: 100,
        startSec: 0,
        endSec: 240,
        bins,
        signalB64: btoa(String.fromCharCode(...tooLong)),
      }),
    ).toThrow(/byte length .* > expected/);
  });
});
