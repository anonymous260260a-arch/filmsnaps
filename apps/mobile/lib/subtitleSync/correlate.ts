/**
 * Offset search, drift solve, and confidence scoring.
 * Pure TypeScript - unit-testable against synthetic signals.
 */

import type { Cue, SpeechSignal } from "./types";

const MAX_OFF = 90; // seconds - BLURAY subs vs web streams differ by up to ~90s (recaps, cold opens, logos)
const STEP = 0.05; // half-bin steps on the 100Hz grid - finer peaks, same cost order
const MIN_CUES = 8;
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
 * Find the offset (seconds) that maximizes the cue-vs-gap contrast.
 * Offset o means: cue time + o lands on speech. Positive = subs were early.
 * Bounds everywhere: sig.data.length is the canonical bin count.
 *
 * Three scorers have been tried on real streams; the first two each lost a file
 * that a human could see was simply shifted:
 *   - raw speech / insideBins let large offsets win by discarding most cues and
 *     scoring a lucky handful (+88.65s at 0.583 vs the true -1.5s).
 *   - raw speech / totalBins made the winner depend on how much cue time the
 *     window happened to contain, so a true-but-clipped offset lost to an
 *     all-inside wrong one (Blacklist +54s -> -6.25s, Lanterns +85.25s ->
 *     -10.45s).
 *   - baseline-relative excess (coverage - window baseline) fixed the geometry
 *     bias in the arithmetic but still used the whole window as the null
 *     sample, so a large offset dragged its own uncovered lead-in into the
 *     baseline and diluted itself.
 * The paired contrast above uses the inter-cue gaps - the only sample that
 * means "no subtitle is being displayed here" - and is geometry-free.
 *
 * runnerUp is the best score OUTSIDE the winner's +-1s shoulder (adjacent grid
 * steps always score nearly the same and would make every peak look flat).
 * `top` lists the strongest distinct candidates: the orchestrator logs them so a
 * wrong pick names its rivals in the field instead of needing a rebuilt APK.
 */
export function findOffset(cues: Cue[], sig: SpeechSignal): OffsetResult {
  const P = makePrefix(sig);
  const N = sig.data.length;
  const steps = Math.round((2 * MAX_OFF) / STEP);
  const scores = new Float64Array(steps + 1).fill(Number.NEGATIVE_INFINITY);
  const keeps = new Float64Array(steps + 1);

  // Speech baseline: the fraction of the scanned span the VAD marks as speech.
  // Reported for diagnostics only - the score no longer depends on it.
  let speechBins = 0;
  for (let i = 0; i < N; i++) speechBins += sig.data[i];
  const baseline = N > 0 ? speechBins / N : 0;

  const totalBins = Math.max(1, totalCueBins(cues, sig.rate));
  const shoulder = Math.round(PEAK_SHOULDER_SEC / STEP);

  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestIdx = -1;
  let bestKeep = 0;
  // Best candidate ignoring MIN_KEEP - used only when no offset is eligible
  // (degenerate geometry: a cue set much wider than the scanned span).
  let anyBest = 0;
  let anyBestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i <= steps; i++) {
    const offSec = -MAX_OFF + i * STEP;
    const ct = contrastAt(cues, sig, P, offSec);
    if (!ct.valid) continue;
    if (ct.score > anyBestScore) {
      anyBestScore = ct.score;
      anyBest = offSec;
    }
    const keep = Math.min(1, ct.cueBins / totalBins);
    if (keep < MIN_KEEP) continue;
    keeps[i] = keep;
    scores[i] = ct.score;
    if (ct.score > bestScore) {
      bestScore = ct.score;
      best = offSec;
      bestIdx = i;
      bestKeep = keep;
    }
  }

  if (bestIdx < 0) {
    best = anyBest;
    bestScore = Number.isFinite(anyBestScore) ? anyBestScore : 0;
  }

  // Runner-up = best score outside the winner's shoulder.
  let runnerUp = bestScore;
  let runnerUpFound = false;
  if (bestIdx >= 0) {
    for (let i = 0; i <= steps; i++) {
      if (scores[i] === Number.NEGATIVE_INFINITY) continue;
      if (Math.abs(i - bestIdx) <= shoulder) continue;
      if (!runnerUpFound || scores[i] > runnerUp) {
        runnerUp = scores[i];
        runnerUpFound = true;
      }
    }
  }

  const top: OffsetCandidate[] = [];
  if (bestIdx >= 0) {
    const ranked: number[] = [];
    for (let i = 0; i <= steps; i++) {
      if (scores[i] === Number.NEGATIVE_INFINITY) continue;
      ranked.push(i);
    }
    ranked.sort((a, b) => scores[b] - scores[a]);
    for (const i of ranked) {
      const offSec = -MAX_OFF + i * STEP;
      if (top.some((t) => Math.abs(t.offset - offSec) <= PEAK_SHOULDER_SEC))
        continue;
      top.push({ offset: offSec, score: scores[i], keep: keeps[i] });
      if (top.length >= TOP_CANDIDATES) break;
    }
  }

  return {
    offset: best,
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
