/**
 * Offset search, drift solve, and confidence scoring.
 * Pure TypeScript - unit-testable against synthetic signals.
 */

import type { Cue, SpeechSignal } from "./types";

const MAX_OFF = 90; // seconds - BLURAY subs vs web streams differ by up to ~90s (recaps, cold opens, logos)
const MIN_CUES = 8;
/** Local refine around an FFT coarse peak: ±0.5s at 0.01s (101 contrastAt calls). */
const REFINE_HALF_SEC = 0.5;
const REFINE_STEP = 0.01;
/** Distinct FFT peaks scored with contrastAt before stopping (winner + rivals). */
const FFT_PEAKS_SCORED = 6;
/**
 * An offset is eligible only when it leaves at least this share of the cue
 * set's time inside the scanned span. Below it the score would come from a
 * small slice of the file - the cherry-pick failure where +88.65s scored 0.583
 * by keeping a lucky handful of cues while the true -1.5s lost.
 */
const MIN_KEEP = 0.35;
/**
 * Null-sample guards. The paired contrast needs the inter-cue gaps to be
 * observable: they must make up at least this share of the cue time and at
 * least this many bins. Cue sets with (almost) no gaps cannot be judged.
 */
const MIN_NULL_FRACTION = 0.1;
const MIN_NULL_BINS = 50;
/** Speech-density excess (0..1) that counts as full confidence. */
const CONTRAST_HEADROOM = 0.25;
/** Offsets within this window around the best are the peak's shoulder, not a rival peak. */
const PEAK_SHOULDER_SEC = 1.0;
/** Candidate offsets reported for diagnostics. */
const TOP_CANDIDATES = 3;

export const APPLY_CONF = 0.6;
export const TRY_CONF = 0.3;

/** Decode base64 signal to Uint8Array of 0/1 bits. */
export function b64ToBits(b64: string, n: number): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  }
  return out;
}

/** One prefix sum per signal, shared by findOffset + confidence. */
function makePrefix(sig: SpeechSignal): Float64Array {
  const P = new Float64Array(sig.data.length + 1);
  for (let i = 0; i < sig.data.length; i++) P[i + 1] = P[i] + sig.data[i];
  return P;
}

/** Total cue time in bins. Offset-independent: the keep denominator. */
function totalCueBins(cues: Cue[], rate: number): number {
  let total = 0;
  for (const c of cues)
    total += Math.max(1, Math.round((c.end - c.start) * rate));
  return total;
}

export type OffsetCandidate = { offset: number; score: number; keep: number };

export type OffsetResult = {
  offset: number;
  /** FFT cross-correlation peak (seconds), before local contrast refine. */
  coarse: number;
  score: number;
  runnerUp: number;
  baseline: number;
  keep: number;
  top: OffsetCandidate[];
};

type Contrast = {
  valid: boolean;
  /** speech density under the cues minus speech density in the gaps */
  score: number;
  cueBins: number;
  nullBins: number;
  cueCoverage: number;
  nullCoverage: number;
};

const INVALID: Contrast = {
  valid: false,
  score: 0,
  cueBins: 0,
  nullBins: 0,
  cueCoverage: 0,
  nullCoverage: 0,
};

/**
 * Paired contrast at one offset - the core statistic.
 *
 *   score(o) = speech density UNDER the cues - speech density BETWEEN the cues
 *
 * Both samples come from the same stretch of audio and from the same cue set:
 *   - "under the cues"   = the cue intervals, clipped to the scanned span
 *   - "between the cues" = the inter-cue gaps that fall between them (from the
 *                          first observable cue to the last one)
 * Nothing outside that span enters the null sample. That is the whole point: at
 * a large offset the cue set leaves a lead-in (and a tail) uncovered, and those
 * regions are content the subtitle file simply does not describe (a recap the
 * WEB-DL file omits, an episode-relative shift, ...). Counting them as "the
 * background" diluted the true offset: Blacklist's +54s put 54s of dense recap
 * dialogue into the baseline, which is exactly what made the truth lose to
 * -6.25s, and Lanterns' +85.25s dragged 179s of lead-in in and lost to -10.45s.
 *
 * What is left is the signal subtitle timing actually carries: dialogue in
 * those windows where a cue is displayed, pauses in the gaps where no cue is -
 * measured inside the same content, so it cannot be won by window geometry.
 * A cue set with no usable gaps cannot be judged and reports `valid: false`
 * (this is what kills cherry-picked offsets that keep a couple of cues).
 */
function contrastAt(
  cues: Cue[],
  sig: SpeechSignal,
  P: Float64Array,
  offset: number,
): Contrast {
  const N = sig.data.length;
  const shift = offset - sig.startSec;
  let cueBins = 0;
  let speechCue = 0;
  let firstStart = -1;
  let lastEnd = -1;

  for (const c of cues) {
    // Clip cues to the span instead of dropping them: a cue that only half
    // fits still carries evidence for the half that fits.
    const a = Math.max(0, Math.round((c.start + shift) * sig.rate));
    const b = Math.min(N, Math.round((c.end + shift) * sig.rate));
    if (b <= a) continue;
    cueBins += b - a;
    speechCue += P[b] - P[a];
    if (firstStart < 0 || a < firstStart) firstStart = a;
    if (b > lastEnd) lastEnd = b;
  }

  if (firstStart < 0 || lastEnd <= firstStart) return INVALID;
  const nullBins = lastEnd - firstStart - cueBins;
  if (
    cueBins < 10 ||
    nullBins < MIN_NULL_BINS ||
    nullBins < MIN_NULL_FRACTION * cueBins
  ) {
    return INVALID;
  }

  const speechNull = P[lastEnd] - P[firstStart] - speechCue;
  const cueCoverage = speechCue / cueBins;
  const nullCoverage = speechNull / nullBins;
  return {
    valid: true,
    score: cueCoverage - nullCoverage,
    cueBins,
    nullBins,
    cueCoverage,
    nullCoverage,
  };
}

/**
 * Cue-vs-gap contrast for `cues` clipped to `sig`'s span at `offset`, 0 when the
 * offset cannot be judged there (no cues inside, or no observable gaps).
 *
 * This is the cross-validation primitive: a candidate offset found in one
 * window is re-scored against the OTHER window's audio. A true offset explains
 * the dialogue in every stretch of the file, while a coincidental local match
 * (the rhythm of one cue slice happening to fit one stretch of speech) explains
 * only the window it was found in and scores ~0 elsewhere.
 */
export function contrastScore(
  cues: Cue[],
  sig: SpeechSignal,
  offset: number,
): number | null {
  const ct = contrastAt(cues, sig, makePrefix(sig), offset);
  // null = the band could NOT be judged (no cues inside the span, or no
  // observable inter-cue gaps). Distinct from 0.0 = judged, and found to sit
  // exactly at chance. The ladder reports the three states separately (B3).
  return ct.valid ? ct.score : null;
}

/**
 * In-place radix-2 FFT (no dependencies). `inverse` divides by n.
 * re/im must be length a power of two.
 */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const xr = re[b] * curRe - im[b] * curIm;
        const xi = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Bipolar cue/gap mask on the signal-relative axis (index 0 = sig.startSec,
 * offset 0). +1 under cues, -1 in inter-cue gaps (first cue start .. last cue
 * end), 0 outside. Cross-correlating speech against this approximates the
 * paired contrast so the FFT peak lands near the true offset.
 */
function buildBipolarMask(cues: Cue[], sig: SpeechSignal): Float64Array {
  const N = sig.data.length;
  const rate = sig.rate;
  const mask = new Float64Array(N);
  if (cues.length === 0) return mask;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const c of cues) {
    if (c.start < first) first = c.start;
    if (c.end > last) last = c.end;
  }
  const gapA = Math.max(0, Math.round((first - sig.startSec) * rate));
  const gapB = Math.min(N, Math.round((last - sig.startSec) * rate));
  for (let i = gapA; i < gapB; i++) mask[i] = -1;
  for (const c of cues) {
    const a = Math.max(0, Math.round((c.start - sig.startSec) * rate));
    const b = Math.min(N, Math.round((c.end - sig.startSec) * rate));
    for (let i = a; i < b; i++) mask[i] = 1;
  }
  return mask;
}

/**
 * FFT cross-correlation peak search over ±MAX_OFF.
 * Returns coarse offsets (seconds), strongest first, ≥1s apart.
 */
function fftCoarsePeaks(cues: Cue[], sig: SpeechSignal): number[] {
  const N = sig.data.length;
  const rate = sig.rate;
  if (N === 0 || cues.length === 0) return [];
  const maxLag = Math.round(MAX_OFF * rate);
  const mask = buildBipolarMask(cues, sig);
  let cueMass = 0;
  for (let i = 0; i < N; i++) cueMass += mask[i] !== 0 ? 1 : 0;
  if (cueMass === 0) return [];

  // Pad so r[k] = sum speech[i]*mask[i-k] is linear (not circular) for |k|<=maxLag.
  const m = nextPow2(N + 2 * maxLag);
  const xRe = new Float64Array(m);
  const xIm = new Float64Array(m);
  const yRe = new Float64Array(m);
  const yIm = new Float64Array(m);
  // Shift by maxLag so negative lags index cleanly: both share the same origin.
  for (let i = 0; i < N; i++) {
    xRe[maxLag + i] = sig.data[i];
    yRe[maxLag + i] = mask[i];
  }
  fft(xRe, xIm, false);
  fft(yRe, yIm, false);
  // corr = IFFT(X * conj(Y)) => r[k] = sum_i x[i] * y[i-k]
  // with both arrays origin-shifted by maxLag: peak for lag L (bins) sits at
  // circular index L>=0 ? L : m+L, and equals offset L/rate seconds.
  for (let i = 0; i < m; i++) {
    const a = xRe[i];
    const b = xIm[i];
    const c = yRe[i];
    const d = -yIm[i];
    xRe[i] = a * c - b * d;
    xIm[i] = a * d + b * c;
  }
  fft(xRe, xIm, true);

  // Flatten ±maxLag into a linear array so local-max scans do not wrap.
  const span = 2 * maxLag + 1;
  const mags = new Float64Array(span);
  for (let L = -maxLag; L <= maxLag; L++) {
    const src = L >= 0 ? L : m + L;
    mags[L + maxLag] = xRe[src];
  }

  const peaks: { off: number; mag: number }[] = [];
  for (let i = 1; i < span - 1; i++) {
    const prev = mags[i - 1];
    const cur = mags[i];
    const next = mags[i + 1];
    if (cur >= prev && cur > next) {
      peaks.push({ off: (i - maxLag) / rate, mag: cur });
    }
  }
  peaks.sort((a, b) => b.mag - a.mag);

  const out: number[] = [];
  for (const p of peaks) {
    if (out.some((o) => Math.abs(o - p.off) <= PEAK_SHOULDER_SEC)) continue;
    out.push(p.off);
    if (out.length >= FFT_PEAKS_SCORED) break;
  }
  // Periodic/degenerate masks can yield no strict local max: fall back to lag 0.
  if (out.length === 0) out.push(0);
  return out;
}

type RefinedPeak = {
  coarse: number;
  offset: number;
  score: number;
  keep: number;
  valid: boolean;
};

/** Score one coarse peak: contrastAt scan in ±REFINE_HALF_SEC at REFINE_STEP. */
function refinePeak(
  cues: Cue[],
  sig: SpeechSignal,
  P: Float64Array,
  totalBins: number,
  coarse: number,
): RefinedPeak {
  const from = Math.max(-MAX_OFF, coarse - REFINE_HALF_SEC);
  const to = Math.min(MAX_OFF, coarse + REFINE_HALF_SEC);
  let bestOff = coarse;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKeep = 0;
  let bestValid = false;
  for (let t = from; t <= to + 1e-9; t += REFINE_STEP) {
    const off = Math.round(t * 1000) / 1000;
    const ct = contrastAt(cues, sig, P, off);
    if (!ct.valid) continue;
    const keep = Math.min(1, ct.cueBins / totalBins);
    if (!bestValid || ct.score > bestScore) {
      bestValid = true;
      bestScore = ct.score;
      bestOff = off;
      bestKeep = keep;
    }
  }
  if (!bestValid) {
    return {
      coarse,
      offset: coarse,
      score: Number.NEGATIVE_INFINITY,
      keep: 0,
      valid: false,
    };
  }
  return {
    coarse,
    offset: bestOff,
    score: bestScore,
    keep: bestKeep,
    valid: true,
  };
}

/**
 * Find the offset (seconds) that maximizes the cue-vs-gap contrast.
 * Offset o means: cue time + o lands on speech. Positive = subs were early.
 *
 * Search strategy (P3-2): an FFT cross-correlation of speech against a
 * bipolar cue/gap mask proposes coarse peaks over ±90s; each is refined with
 * the existing contrastAt scorer at ±0.5s / 0.01s. runnerUp is the next
 * distinct FFT peak scored on the contrast scale (confidence reads it as a
 * rival, never as a raw FFT magnitude). Wall time is logged — the old
 * ±90s@0.05s brute grid was ~50-200ms; this path should stay under ~10ms.
 *
 * Three scorers have been tried on real streams; contrastAt (paired cue vs
 * inter-cue-gap density) is the one that survived — see contrastAt.
 * MIN_KEEP still gates eligibility: a coarse peak that would discard most of
 * the cue set is skipped for the next peak, then anyBest fallback.
 */
export function findOffset(cues: Cue[], sig: SpeechSignal): OffsetResult {
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const P = makePrefix(sig);
  const N = sig.data.length;

  // Speech baseline: the fraction of the scanned span the VAD marks as speech.
  // Reported for diagnostics only - the score no longer depends on it.
  let speechBins = 0;
  for (let i = 0; i < N; i++) speechBins += sig.data[i];
  const baseline = N > 0 ? speechBins / N : 0;

  const totalBins = Math.max(1, totalCueBins(cues, sig.rate));
  const coarsePeaks = fftCoarsePeaks(cues, sig);

  const refined: RefinedPeak[] = [];
  for (const coarse of coarsePeaks) {
    refined.push(refinePeak(cues, sig, P, totalBins, coarse));
  }

  let winner: RefinedPeak | null = null;
  let anyBest: RefinedPeak | null = null;
  for (const r of refined) {
    if (!r.valid) continue;
    if (!anyBest || r.score > anyBest.score) anyBest = r;
    if (r.keep < MIN_KEEP) continue;
    if (!winner || r.score > winner.score) winner = r;
  }
  if (!winner) winner = anyBest;

  const bestScore = winner && winner.valid ? winner.score : 0;
  const best = winner ? winner.offset : 0;
  const bestKeep = winner ? winner.keep : 0;
  const coarse = winner ? winner.coarse : 0;

  // Runner-up = best keep-eligible peak outside the winner's shoulder,
  // scored on the contrast scale (same units confidence expects).
  let runnerUp = bestScore;
  let runnerUpFound = false;
  if (winner) {
    for (const r of refined) {
      if (!r.valid || r.keep < MIN_KEEP) continue;
      if (Math.abs(r.offset - winner.offset) <= PEAK_SHOULDER_SEC) continue;
      if (!runnerUpFound || r.score > runnerUp) {
        runnerUp = r.score;
        runnerUpFound = true;
      }
    }
  }

  const ranked = refined
    .filter((r) => r.valid && r.keep >= MIN_KEEP)
    .sort((a, b) => b.score - a.score);
  const top: OffsetCandidate[] = [];
  for (const r of ranked) {
    if (top.some((t) => Math.abs(t.offset - r.offset) <= PEAK_SHOULDER_SEC))
      continue;
    top.push({ offset: r.offset, score: r.score, keep: r.keep });
    if (top.length >= TOP_CANDIDATES) break;
  }

  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  console.log(
    `[SubSync] findOffset: ${(t1 - t0).toFixed(1)}ms ` +
      `(fft peaks=${coarsePeaks.length} refine=${refined.length})`,
  );

  return {
    offset: best,
    coarse,
    score: bestScore,
    runnerUp,
    baseline,
    keep: bestKeep,
    top,
  };
}

/**
 * Compute confidence [0..1] for a given offset.
 * High confidence = cues sit on speech clearly more often than the gaps do, and
 * the peak stands out from its rivals.
 */
export function confidence(
  cues: Cue[],
  sig: SpeechSignal,
  offset: number,
  runnerUpScore: number,
  bestScore: number,
): number {
  if (cues.length < MIN_CUES) return 0;
  const P = makePrefix(sig);
  const N = sig.data.length;

  let speech = 0;
  for (let i = 0; i < N; i++) speech += sig.data[i];
  const baseline = speech / N;

  // Degenerate signal: something marked (almost) everything as speech (loud
  // music, broken capture). Density cannot discriminate -> no confidence.
  if (baseline > 0.9) return 0;
  // Sparse twin: content-dead window (credits music under Silero ≈ 0.003).
  // A junk peak can still clear the dense guard — refuse to score it.
  if (baseline < 0.02) return 0;

  const ct = contrastAt(cues, sig, P, offset);
  if (!ct.valid) return 0;

  // keep: how much of the window's cue time is observable at this offset. A
  // score computed from a small slice of the cue set is not evidence, so
  // confidence decays with the discarded fraction.
  const keep = Math.min(
    1,
    ct.cueBins / Math.max(1, totalCueBins(cues, sig.rate)),
  );

  // coverageScore: contrast on a fixed realistic headroom. The old
  // (coverage - baseline)/(0.65 - baseline) ceiling broke when the energy VAD
  // raised the baseline to 0.57-0.70: the denominator hit ~0 or went NEGATIVE
  // (crediting coverage below baseline with a perfect score), collapsing every
  // confidence to ~0.001 no matter how good the alignment was.
  const coverageScore = Math.max(0, Math.min(1, ct.score / CONTRAST_HEADROOM));
  // sharpness: the winner's excess over its rival, relative to a small floor.
  // Dividing by bestScore alone amplified noise - a flat curve's best 0.005 vs
  // runner-up 0.004 looked "sharp". The floor keeps genuine peaks at 1.0 while
  // noise collapses toward 0.
  const sharpness =
    bestScore > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((bestScore - runnerUpScore) / Math.max(bestScore, 0.02)) * 1.5,
          ),
        )
      : 0;

  const raw = 0.6 * coverageScore + 0.4 * sharpness;
  // Offsets judged on >= 50% of the cue set are unaffected; below that the
  // confidence decays linearly, down to 0.35 (MIN_KEEP, the point where the
  // offset is not eligible at all) which still carries ~70% of the weight. The
  // window between those two numbers is the honest "judged on a partial cue
  // set" discount - it must not be so steep that a legitimately clipped true
  // offset (Lanterns' +85.25s keeps 41%) reads as unusable.
  return raw * Math.min(1, keep / 0.5);
}

/**
 * Fraction of the window's total cue time that lands inside the scanned span at
 * `offset`. <1 means the offset pushes cues past the signal edges - the
 * correlation for such an offset is judged on a partial cue set, and a very low
 * value means the window could not really judge this offset at all.
 */
export function keptFraction(
  cues: Cue[],
  sig: SpeechSignal,
  offset: number,
): number {
  const N = sig.data.length;
  const shift = offset - sig.startSec;
  let total = 0;
  let kept = 0;
  for (const c of cues) {
    total += Math.max(1, Math.round((c.end - c.start) * sig.rate));
    const a = Math.max(0, Math.round((c.start + shift) * sig.rate));
    const b = Math.min(N, Math.round((c.end + shift) * sig.rate));
    if (b > a) kept += b - a;
  }
  if (total <= 0) return 0;
  return Math.min(1, kept / total);
}

/**
 * Solve for drift (scale factor) between two windows.
 * Returns scale and combined offset. |scale - 1| >= 5e-4 means drift is significant.
 */
export function solveDrift(
  earlyOffset: number,
  earlyCueMeanStart: number,
  lateOffset: number,
  lateCueMeanStart: number,
): { scale: number; offset: number } {
  const t1 = earlyCueMeanStart;
  const t2 = lateCueMeanStart;
  const dt = t2 - t1;
  if (Math.abs(dt) < 1) return { scale: 1, offset: earlyOffset };

  const scale = (t2 + lateOffset - (t1 + earlyOffset)) / dt;
  const offset = t1 + earlyOffset - scale * t1;
  return { scale, offset };
}

/** Mean cue start time for a window's cues. */
export function meanCueStart(cues: Cue[]): number {
  if (cues.length === 0) return 0;
  let sum = 0;
  for (const c of cues) sum += c.start;
  return sum / cues.length;
}
