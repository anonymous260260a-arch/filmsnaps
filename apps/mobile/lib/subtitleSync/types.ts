/**
 * Core types for subtitle auto-sync engine.
 * Pure TypeScript â€” no React, no platform calls.
 */

export type SubFormat = "srt" | "vtt" | "ass" | "ssa" | "sub";

export type Cue = { start: number; end: number; text: string };

export type SpeechSignal = {
  rate: 100; // always 100Hz bins
  startSec: number;
  endSec: number;
  bins: number; // total bin count
  data: Uint8Array; // 0/1 per bin â€” canonical length; all bounds checks use this
};

export type SyncOutcome =
  | {
      type: "offset";
      offsetMs: number;
      confidence: number;
      rewritten?: {
        uri: string;
        mimeType: string;
        language?: string;
        label?: string;
      };
    }
  | { type: "rewritten"; fileUri: string; confidence: number }
  /** Re-sync could not improve an already-shifted file — keep the existing sync. */
  | { type: "kept"; existingOffsetMs: number; reason: string }
  | { type: "failed"; reason: string }
  | { type: "cancelled" };

/** Validate Â§1.3 invariants on a received signal. Returns clamped signal or throws. */
export function validateSignal(raw: {
  rate: number;
  startSec: number;
  endSec: number;
  bins: number;
  signalB64: string;
}): SpeechSignal {
  if (raw.rate !== 100) throw new Error(`unexpected rate ${raw.rate}`);

  let binData = b64ToUint8(raw.signalB64);
  const expectedBins = raw.bins;
  const expectedBytes = Math.ceil(expectedBins / 8);

  // Over-long arrays are never legitimately produced (packing is append-in-order,
  // and we pad rather than exceed) â€” treat as schema corruption. Keep the Â±1
  // slack for rounding.
  if (binData.length > expectedBytes + 1) {
    throw new Error(
      `signalB64 byte length ${binData.length} > expected ${expectedBytes} (bins=${expectedBins})`,
    );
  }
  // Trailing-zero trim (BitSet semantics) â€” a short array can only mean "all
  // bins >= 8Â·length are zero" (a silent tail), never mid-stream corruption.
  // Pad, don't reject.
  if (binData.length < expectedBytes) {
    const padded = new Uint8Array(expectedBytes);
    padded.set(binData);
    binData = padded;
  }

  // Extract individual bits into a Uint8Array of 0/1 values
  const data = new Uint8Array(expectedBins);
  for (let i = 0; i < expectedBins; i++) {
    data[i] = (binData[i >> 3] >> (i & 7)) & 1;
  }

  return {
    rate: 100,
    startSec: raw.startSec,
    endSec: raw.endSec,
    bins: expectedBins,
    data,
  };
}

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
