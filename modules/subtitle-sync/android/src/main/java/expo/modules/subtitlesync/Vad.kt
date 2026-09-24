package expo.modules.subtitlesync

import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Voice Activity Detection interface.
 * Called with exactly 512 float samples @ 16kHz mono [-1..1].
 * Returns speech probability 0..1 (every consumer thresholds at 0.5).
 */
interface Vad {
    fun process(chunk: FloatArray): Float
    fun reset()
}

/**
 * Energy VAD with a WINDOW-GLOBAL adaptive gate.
 *
 * History, because this gate is the difference between "sync works" and "sync
 * finds nothing" - the aligner ranks offsets by *where the speech is*, so the
 * signal must separate dialogue from everything else, not merely separate
 * "audible" from "silent":
 *
 *   - The original gate followed the local *mean* level (two-sided floor
 *     tracker), so it sat inside the dialogue level range: sparse (~0.17 duty)
 *     but high-contrast. Failure mode: a music swell dragged the floor up and
 *     starved the dialogue that followed.
 *   - A later rework kept a slow-rise/fast-fall min-statistics floor and gated
 *     at ~1.6x that floor. That tracks *room tone*, so anything above the noise
 *     floor counted as speech: duty rose to 0.57-0.70 on dialogue-heavy audio.
 *     At that density the signal is a "not-silent" detector that says almost
 *     nothing about where dialogue is, and the correlation surface goes flat.
 *     Observed on device: every window scored confidence 0.001-0.22 and the
 *     argmax landed on unrelated offsets (a true +54s was reported as -61.2s
 *     in the early window and -3.4s in the late one, so nothing ever applied).
 *
 * This gate is a quantile of the levels seen *in this scan*: a chunk is speech
 * when its level falls in the loudest TARGET_SPEECH_FRACTION of the window's
 * own level distribution. That gives
 *   - a self-calibrating duty cycle (a quiet source is not "all silence", a
 *     loud one is not "all speech"),
 *   - per-region contrast, which is what the aligner ranks on: dialogue
 *     regions mark well above the window-wide duty, music beds and room tone
 *     well below it,
 *   - immunity to the failure mode above: a brief music swell cannot move a
 *     window-wide quantile the way it moved a local mean tracker.
 * The min-statistics floor is kept as an absolute guard so that a near-silent
 * window cannot be split into "loudest 20% = speech".
 *
 * The quantile is SERVOED on the measured duty cycle rather than fixed. A fixed
 * quantile cannot hold the duty cycle: the hysteresis (which is what stops the
 * marks flickering) keeps a chunk marked through dips below the gate, and how
 * much that inflates the result depends entirely on the content's dynamics.
 * Measured on device: one file (Blacklist, HLS) landed at 0.227 as intended
 * while another (Lioness, progressive MKV) landed at 0.454 - i.e. back in the
 * dense regime that flattens the correlation. So the gate measures its own mark
 * rate and moves the quantile to hold it at TARGET_SPEECH_FRACTION, which makes
 * the duty cycle a property of this detector rather than of the mix.
 */
class EnergyVad : Vad {
    private companion object {
        /** Histogram of chunk levels: HIST_BUCKETS buckets of 1 dB over [-80..0] dBFS. */
        const val HIST_MIN_DB = -80.0
        const val HIST_MAX_DB = 0.0
        const val HIST_BUCKETS = 80
        const val HIST_STEP_DB = (HIST_MAX_DB - HIST_MIN_DB) / HIST_BUCKETS

        /**
         * Speech = the loudest 20% of the window's chunks. The working
         * pre-regression regime was ~0.17 duty; anything much denser washes the
         * correlation out (see the class doc). This is the SETPOINT of the duty
         * cycle servo below, not a fixed quantile.
         */
        const val TARGET_SPEECH_FRACTION = 0.20

        /**
         * Duty-cycle servo: measured mark rate (EMA, ~8 s) drives the quantile.
         * Rate above the setpoint -> mark fewer chunks (quantile down).
         */
        const val MARK_RATE_TAU = 256.0
        const val RATE_GAIN = 0.01
        const val QUANTILE_MIN = 0.02
        const val QUANTILE_MAX = 0.6

        /**
         * Histogram memory, in chunks (~131 s at 31.25 chunks/s): long enough
         * that the gate describes the whole scan window rather than the last
         * few seconds, short enough to follow a long scene change.
         */
        const val HIST_TIME_CONSTANT = 4096.0
        const val HIST_DECAY = 1.0 - 1.0 / HIST_TIME_CONSTANT

        /** -3 dB: once speaking, the level must fall this far to leave speech. */
        const val HYSTERESIS_DROP = 0.708

        /** The gate never sits below 2x the noise floor (+6 dB). */
        const val FLOOR_GUARD = 2.0

        /**
         * Flat prior so the quantile is defined from the first chunk (a gate of
         * roughly -17 dBFS). The real data outweighs it within ~1 s.
         */
        const val PRIOR_MASS = 32.0
        const val PRIOR_MIN_DB = -70.0
        const val PRIOR_MAX_DB = -15.0
    }

    /** Min-statistics noise floor (linear RMS). */
    private var noiseFloor = 1e-4

    /** Current speech gate (linear RMS). */
    private var gate = 0.0

    private var speaking = false

    /** Quantile the gate currently sits at (servoed on the measured mark rate). */
    private var quantile = TARGET_SPEECH_FRACTION

    /** EMA of the actual mark rate (1.0 per marked chunk, 0.0 otherwise). */
    private var markRate = TARGET_SPEECH_FRACTION

    /** Decaying histogram of chunk levels (mass, not normalized). */
    private val hist = DoubleArray(HIST_BUCKETS)

    init {
        reset()
    }

    override fun reset() {
        noiseFloor = 1e-4
        gate = 0.0
        speaking = false
        quantile = TARGET_SPEECH_FRACTION
        markRate = TARGET_SPEECH_FRACTION
        java.util.Arrays.fill(hist, 0.0)
        val lo = bucketOf(PRIOR_MIN_DB)
        val hi = bucketOf(PRIOR_MAX_DB)
        val per = PRIOR_MASS / (hi - lo + 1).toDouble()
        for (b in lo..hi) hist[b] = per
    }

    override fun process(chunk: FloatArray): Float {
        var sum = 0.0
        for (v in chunk) sum += v.toDouble() * v.toDouble()
        val rms = sqrt(sum / chunk.size)

        // Min-statistics floor: falls fast (tracks room tone within ~1 s),
        // rises slowly so a music swell cannot become the new "silence".
        if (rms < noiseFloor) {
            noiseFloor += (rms - noiseFloor) * 0.05
        } else {
            noiseFloor += (rms - noiseFloor) * 0.001
        }

        // Window-global level distribution, then the gate at its top quantile.
        val db = if (rms > 1e-7) 20.0 * log10(rms) else HIST_MIN_DB - 1.0
        for (i in hist.indices) hist[i] *= HIST_DECAY
        hist[bucketOf(db)] += 1.0

        gate = max(dbToLinear(quantileGateDb()), noiseFloor * FLOOR_GUARD)

        speaking = if (speaking) rms >= gate * HYSTERESIS_DROP else rms >= gate
        val marked = if (speaking) 1.0 else 0.0

        // Servo the quantile on the measured duty cycle so hysteresis (and
        // whatever the mix is doing) cannot inflate the mark rate.
        markRate += (marked - markRate) / MARK_RATE_TAU
        quantile = (quantile + RATE_GAIN * (TARGET_SPEECH_FRACTION - markRate))
            .coerceIn(QUANTILE_MIN, QUANTILE_MAX)

        return if (speaking) 1f else 0f
    }

    /** Bucket index for a dBFS level. */
    private fun bucketOf(db: Double): Int {
        val b = floor((db - HIST_MIN_DB) / HIST_STEP_DB).toInt()
        return b.coerceIn(0, HIST_BUCKETS - 1)
    }

    private fun dbOfBucket(b: Int): Double = HIST_MIN_DB + b * HIST_STEP_DB

    private fun dbToLinear(db: Double): Double = 10.0.pow(db / 20.0)

    /**
     * Level (dBFS) that separates the loudest `quantile` of the window's chunks
     * from the rest: walk the histogram from the loudest bucket down until the
     * accumulated mass reaches the target.
     */
    private fun quantileGateDb(): Double {
        var total = 0.0
        for (m in hist) total += m
        if (total <= 0.0) return PRIOR_MIN_DB
        val target = total * quantile
        var acc = 0.0
        for (b in HIST_BUCKETS - 1 downTo 0) {
            acc += hist[b]
            if (acc >= target) return dbOfBucket(b)
        }
        return dbOfBucket(0)
    }
}
