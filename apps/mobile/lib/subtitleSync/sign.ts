/**
 * Sign convention for subtitle offset.
 *
 * Verified (Task 0) against patched expo-video:
 *   SecondarySeekHeadMatroskaExtractor applies:
 *     blockTimeUs += (long)(subtitleOffsetMs * 1000d)
 *
 * Positive ms → subtitle timestamps shift forward → subtitles appear LATER.
 * This matches our convention: offsetMs > 0 means "subs were too early, delay them."
 */

const NATIVE_SIGN = 1; // positive = later (verified)

export function toNativeOffset(ms: number): number {
  return NATIVE_SIGN * ms;
}
