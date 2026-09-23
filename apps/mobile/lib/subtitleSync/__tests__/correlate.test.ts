import { describe, it, expect } from "vitest";
import {
  findOffset,
  confidence,
  contrastScore,
  solveDrift,
  meanCueStart,
  b64ToBits,
  APPLY_CONF,
  TRY_CONF,
} from "../correlate";
import type { Cue, SpeechSignal } from "../types";

/**
 * Build a synthetic speech signal: speech at `period` intervals, each lasting `speechDur` seconds.
 * Time range [0, totalDur].
 */
function syntheticSignal(
  totalDur: number,
  period: number,
  speechDur: number,
): SpeechSignal {
  const rate = 100;
  const bins = Math.ceil(totalDur * rate);
  const data = new Uint8Array(bins);
  for (let i = 0; i < bins; i++) {
    const t = i / rate;
    const phase = t % period;
    if (phase < speechDur) data[i] = 1;
  }
  return { rate: 100, startSec: 0, endSec: totalDur, bins, data };
}

/**
 * Build cues that align with the signal's speech segments, offset by `offsetSec`.
 */
function alignedCues(
  period: number,
  speechDur: number,
  count: number,
  offsetSec: number,
): Cue[] {
  const cues: Cue[] = [];
  for (let i = 0; i < count; i++) {
    cues.push({
      start: i * period + offsetSec,
      end: i * period + speechDur + offsetSec,
      text: `cue ${i}`,
    });
  }
  return cues;
}

/**
 * Aperiodic speech signal: bursts of `speechDur` seconds at irregular gaps, so
 * exactly ONE offset aligns the whole cue set. A periodic signal is degenerate
 * for offset estimation - every period alias scores identically - which is fine
 * for modulo assertions but useless for confidence.
 */
function burstSignal(
  totalDur: number,
  seed: number,
  speechDur = 1.0,
): { sig: SpeechSignal; starts: number[] } {
  const rate = 100;
  const bins = Math.ceil(totalDur * rate);
  const data = new Uint8Array(bins);
  const starts: number[] = [];
  let s = 2;
  let x = seed % 2147483648;
  while (s + speechDur < totalDur - 2) {
    starts.push(s);
    for (
      let i = Math.round(s * rate);
      i < Math.round((s + speechDur) * rate);
      i++
    ) {
      data[i] = 1;
    }
    // deterministic LCG -> irregular gaps of 2.2s..5.8s
    x = (x * 1103515245 + 12345) % 2147483648;
    s += 2.2 + (x / 2147483648) * 3.6 + speechDur;
  }
  return { sig: { rate, startSec: 0, endSec: totalDur, bins, data }, starts };
}

describe("correlate", () => {
  // ——— Synthetic recovery ———
  it("finds high score for aligned cues", () => {
    const sig = syntheticSignal(600, 3, 1); // 20 min, speech every 3s
    const cues = alignedCues(3, 1, 50, 2.7);
    const { score } = findOffset(cues, sig);
    // The best offset should have near-perfect overlap
    expect(score).toBeGreaterThan(0.8);
  });

  it("finds high score for zero-offset cues", () => {
    const sig = syntheticSignal(120, 3, 1);
    const cues = alignedCues(3, 1, 20, 0);
    const { score } = findOffset(cues, sig);
    expect(score).toBeGreaterThan(0.8);
  });

  it("finds high score for negative-offset cues", () => {
    const sig = syntheticSignal(120, 3, 1);
    const cues = alignedCues(3, 1, 20, -1.5);
    const { score } = findOffset(cues, sig);
    expect(score).toBeGreaterThan(0.8);
  });

  it("resolves sub-0.1s peaks with the 0.05s step", () => {
    // Cues at [1.55+3k, 2.55+3k] align with speech [3k, 3k+1] at offset
    // -1.55 - exactly on the 0.05s grid but between the old 0.1s test points.
    // The signal is periodic, so any alias -1.55 + 3m is an equally perfect
    // alignment; assert modulo the 3s period.
    const sig = syntheticSignal(120, 3, 1);
    const cues = alignedCues(3, 1, 20, 1.55);
    const { offset, score } = findOffset(cues, sig);
    const mod = (((offset + 1.55) % 3) + 3) % 3;
    expect(Math.min(mod, 3 - mod)).toBeLessThanOrEqual(0.06);
    expect(score).toBeGreaterThan(0.9);
  });

  // ——— Confidence ———
  it("high confidence for well-aligned cues", () => {
    // Aperiodic bursts: only the true offset aligns the whole cue set, so the
    // peak is unique. (On a 3s-periodic signal every alias scores 1.0, the scan
    // stops on the first eligible one and the keep-decay caps confidence at
    // ~0.42 - that fixture tests aliasing, not confidence.)
    const { sig, starts } = burstSignal(240, 42);
    const cues: Cue[] = starts.map((s) => ({
      start: s + 2.0,
      end: s + 3.0,
      text: "c",
    }));
    const { offset, score, runnerUp } = findOffset(cues, sig);
    expect(offset).toBeCloseTo(-2.0, 1);
    const conf = confidence(cues, sig, offset, runnerUp, score);
    expect(conf).toBeGreaterThan(APPLY_CONF);
  });

  it("cross-validation separates a true offset from a far decoy", () => {
    // Reproduces autoSync's disagreement arbitration (Lioness S01E01: the late
    // window's -73.90s out-scored the true early +0.65s on confidence and was
    // applied). One aperiodic "episode" with the true offset +0.7s; the early
    // window sees 0-240s and the late window 2150-2270s of the SAME episode.
    const totalDur = 2400;
    const { sig: episode, starts } = burstSignal(totalDur, 7);
    // The file is off by cueShift: cue = burst start + cueShift, so aligning it
    // needs offset = -cueShift (cue time + offset = burst time).
    const cueShift = 0.7;
    const trueOffset = -cueShift;
    const cues: Cue[] = starts.map((s) => ({
      start: s + cueShift,
      end: s + 1 + cueShift,
      text: "c",
    }));
    const earlySig: SpeechSignal = {
      rate: 100,
      startSec: 0,
      endSec: 240,
      bins: 24000,
      data: episode.data.slice(0, 24000),
    };
    const lateSig: SpeechSignal = {
      rate: 100,
      startSec: 2150,
      endSec: 2270,
      bins: 12000,
      data: episode.data.slice(215000, 227000),
    };
    // The true candidate is corroborated on the late window's audio...
    // contrastScore returns null for a band that cannot be judged (B3).
    const crossTrue = contrastScore(cues, lateSig, trueOffset) ?? -1;
    // ...while a far decoy is not corroborated on the early window's audio.
    const crossDecoy = contrastScore(cues, earlySig, -73.9) ?? -1;
    expect(crossTrue).toBeGreaterThan(0.03);
    expect(crossDecoy).toBeLessThan(0.03);
    expect(crossTrue).toBeGreaterThan(crossDecoy);
  });

  it("low confidence when sharpness is low (no clear peak)", () => {
    // Dense speech everywhere - every offset scores similarly - low sharpness
    // Coverage is high but sharpness is 0 - overall confidence is moderate at best.
    const bins = 12000; // 120s at 100Hz
    const sig: SpeechSignal = {
      rate: 100,
      startSec: 0,
      endSec: 120,
      bins,
      data: new Uint8Array(bins).fill(1),
    };
    const cues = alignedCues(3, 1, 20, 0);
    const { offset, score, runnerUp } = findOffset(cues, sig);
    const conf = confidence(cues, sig, offset, runnerUp, score);
    expect(conf).toBeLessThan(APPLY_CONF);
  });

  it("zero confidence for a degenerate all-speech signal", () => {
    // VAD marked everything as speech (loud music / broken capture):
    // coverage cannot discriminate, so confidence must be 0 outright.
    const bins = 12000; // 120s at 100Hz, all speech
    const sig: SpeechSignal = {
      rate: 100,
      startSec: 0,
      endSec: 120,
      bins,
      data: new Uint8Array(bins).fill(1),
    };
    const cues = alignedCues(3, 1, 20, 0);
    const conf = confidence(cues, sig, 0, 0, 0.95);
    expect(conf).toBe(0);
  });

  it("low confidence for too few cues", () => {
    const sig = syntheticSignal(60, 3, 1);
    const cues = alignedCues(3, 1, 3, 0); // only 3 cues
    const conf = confidence(cues, sig, 0, 0, 0.5);
    expect(conf).toBe(0);
  });

  // ——— Cherry-pick regression (Lioness: true offset -1.5s, scorer said -86.7s) ———
  it("locks onto the true small offset even with far bait available", () => {
    // 2960s of dialogue-like speech: 1.3s bursts every 6s (relative time).
    const startSec = 93.875;
    const totalDur = 2960;
    const rate = 100;
    const bins = Math.ceil(totalDur * rate);
    const data = new Uint8Array(bins);
    for (let i = 0; i < bins; i++) {
      const t = i / rate; // seconds since startSec
      const phase = (t - 6.5) % 6;
      if (phase >= 0 && phase < 1.3) data[i] = 1;
    }
    const sig: SpeechSignal = {
      rate,
      startSec,
      endSec: startSec + totalDur,
      bins,
      data,
    };
    // Cues aligned at the TRUE offset -1.5s: cue start + (-1.5) lands exactly
    // on a speech burst. Speech bursts start at rel 6.5 + 6m, so cue starts
    // sit at absolute startSec + 8 + 6m.
    const cues: Cue[] = [];
    for (let s = startSec + 8; s < startSec + totalDur - 20; s += 6) {
      cues.push({ start: s, end: s + 1.3, text: "c" });
    }
    const { offset, score } = findOffset(cues, sig);
    // Any period alias is a perfect alignment; assert modulo the 6s period.
    const mod = (((offset + 1.5) % 6) + 6) % 6;
    expect(Math.min(mod, 6 - mod)).toBeLessThanOrEqual(0.06);
    expect(score).toBeGreaterThan(0.5);
  });

  it("decays confidence when an offset discards most of the cue set", () => {
    const sig = syntheticSignal(300, 3, 1);
    const cues = alignedCues(3, 1, 90, 0); // 0s..270s of a 300s span
    const good = findOffset(cues, sig);
    expect(good.score).toBeGreaterThan(0.8);
    const confTrue = confidence(cues, sig, 0, good.runnerUp, good.score);
    // Offset +250s: only cues ending before 50s stay inside the span - the
    // old scorer normalised by that tiny subset and stayed confident.
    const confFar = confidence(cues, sig, 250, good.runnerUp, good.score);
    expect(confFar).toBeLessThan(0.2);
    expect(confFar).toBeLessThan(confTrue);
  });

  // ——— solveDrift ———
  it("returns scale=1 when windows agree", () => {
    const { scale, offset } = solveDrift(2.0, 100, 2.1, 500);
    expect(scale).toBeCloseTo(1, 3);
  });

  it("detects scale deviation", () => {
    // t1=100, t2=500, dt=400
    // early: cue at 100, offset 0 -> effective 100
    // late:  cue at 500, offset 0.4 -> effective 500.4
    // scale = (500.4 - 100) / (500 - 100) = 400.4/400 = 1.001
    const { scale } = solveDrift(0, 100, 0.4, 500);
    expect(scale).toBeCloseTo(1.001, 4);
    expect(Math.abs(scale - 1)).toBeGreaterThanOrEqual(5e-4);
  });

  // ——— meanCueStart ———
  it("computes mean start time", () => {
    const cues: Cue[] = [
      { start: 10, end: 12, text: "" },
      { start: 20, end: 22, text: "" },
      { start: 30, end: 32, text: "" },
    ];
    expect(meanCueStart(cues)).toBe(20);
  });

  it("returns 0 for empty cues", () => {
    expect(meanCueStart([])).toBe(0);
  });

  // ——— b64ToBits ———
  it("decodes base64 to bits (LSB-first)", () => {
    // 0xA1 = 10100001 binary. LSB-first: bit0=1, bit1=0, bit2=0, bit5=1, bit7=1
    const byte1 = String.fromCharCode(0xa1);
    const b64 = btoa(byte1 + "\0\0\0");
    const bits = b64ToBits(b64, 16);
    expect(bits[0]).toBe(1); // LSB
    expect(bits[1]).toBe(0);
    expect(bits[2]).toBe(0);
    expect(bits[5]).toBe(1);
    expect(bits[7]).toBe(1); // MSB
    expect(bits[8]).toBe(0); // next byte, zero
  });
});
