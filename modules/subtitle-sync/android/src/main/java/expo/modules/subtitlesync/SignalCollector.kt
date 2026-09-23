package expo.modules.subtitlesync

import android.media.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.BitSet

/**
 * Collects decoded PCM into 100Hz speech bins at ABSOLUTE content time.
 *
 * The old pipeline indexed bins by sample count from an *estimated* start
 * ("landed position + wall-clock gap * speed"), so any buffering stall smeared
 * the whole signal and correlation collapsed (offset pinned at the search
 * boundary, conf 0.000). Here every decoded chunk carries its presentation
 * timestamp and bins are placed at (contentPtsUs - anchorUs) / 10ms - exact,
 * independent of decode speed, stalls, or seek preroll.
 *
 * The caller rebases raw container PTS into content time before queuing into
 * the decoder (FastScanJob owns the rebase), so this class is timeline-agnostic.
 */
/**
 * R8-1: dual-VAD collection. Energy always runs (trivial RMS). Silero runs
 * alongside when present. Two independent bit sets are maintained; the winner
 * is chosen ONCE at [buildSuccess] (Silero duty >= 0.05, else Energy) — never
 * mid-scan, so a window never mixes marks from two VADs.
 */
class SignalCollector(
    fromUs: Long,
    private val toUs: Long,
    private val silero: SileroVad? = null,
    private val log: ((String) -> Unit)? = null,
    /**
     * Stage D: mark-threshold hysteresis, overridable from JS (engineConstants).
     * Null/omitted → F6 companion defaults (MARK_ON 0.35 / MARK_OFF 0.25).
     */
    private val markOnOverride: Float? = null,
    private val markOffOverride: Float? = null,
) {
    private val energy = EnergyVad()

    /**
     * Bins are indexed relative to this content time (window start - margin).
     * Mutable since B5: a bitrate-aware clamp can shrink the window end, and
     * [resetAll] rebases both bounds.
     */
    var anchorUs: Long = fromUs - WINDOW_MARGIN_US
        private set
    private var windowToUs: Long = toUs + WINDOW_MARGIN_US
    private val bins = BitSet()        // Energy marks (fallback / energy-only)
    private var maxBin = -1
    private val binsSilero = BitSet()  // Silero marks (when silero != null)
    private var maxBinSilero = -1
    /** Latched after a Silero runtime throw — energy alone for the rest of the window. */
    private var sileroFailed = false
    /** F6 rising-edge hysteresis latch for the Silero mark path (energy path is flat 0.5). */
    private var sileroMarkOn = false

    // Pending 512-sample (32ms) VAD chunk spanning decoder buffer boundaries.
    private val pending = ArrayList<Float>(512)
    private var pendingStartUs = -1L

    // Decoder output format state
    private var resampler = Resampler(48_000)
    private var srcRate = 0
    private var channels = 0
    private var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT

    var lastDecodedUs = -1L
        private set
    var firstDecodedUs = -1L
        private set

    /** VAD diagnostics: Energy speech fires vs total chunks processed. */
    var speechChunks = 0L
        private set
    /** Silero speech fires (0 when silero == null). */
    var sileroSpeechChunks = 0L
        private set
    var totalChunks = 0L
        private set

    fun speechRatio(): Float = if (totalChunks > 0) speechChunks.toFloat() / totalChunks else 0f
    fun sileroDuty(): Float = if (totalChunks > 0) sileroSpeechChunks.toFloat() / totalChunks else 0f
    fun energyDuty(): Float = speechRatio()

    /** PCM amplitude stats over processed chunks (silence vs healthy audio). */
    var rmsPeak = 0f
        private set
    var rmsSum = 0.0
        private set

    fun rmsAvg(): Float = if (totalChunks > 0) (rmsSum / totalChunks).toFloat() else 0f

    /** Decoded content span in microseconds (0 when nothing decoded). */
    fun decodedSpanUs(): Long = if (firstDecodedUs >= 0 && lastDecodedUs > firstDecodedUs) lastDecodedUs - firstDecodedUs else 0L

    fun onFormatChanged(sampleRate: Int, channelCount: Int, encoding: Int) {
        if (srcRate != sampleRate || channels != channelCount || pcmEncoding != encoding) {
            srcRate = sampleRate
            channels = channelCount
            pcmEncoding = encoding
            resampler.reset(sampleRate)
            pending.clear()
            pendingStartUs = -1
        }
    }

    /** Drop partial decode state at a PTS discontinuity (seek / segment boundary). */
    fun resetTimeline() {
        pending.clear()
        pendingStartUs = -1
        if (srcRate > 0) resampler.reset(srcRate)
    }

    /**
     * Full reset for an audio-track retry (and, since B5, for rebasing the window
     * after a bitrate clamp): bins, diagnostics, decode state and the window
     * bounds. Callers must use it before any PCM for the window is pushed.
     */
    fun resetAll(fromUs: Long, toUs: Long) {
        anchorUs = fromUs - WINDOW_MARGIN_US
        windowToUs = toUs + WINDOW_MARGIN_US
        pending.clear()
        pendingStartUs = -1
        if (srcRate > 0) resampler.reset(srcRate)
        bins.clear()
        maxBin = -1
        binsSilero.clear()
        maxBinSilero = -1
        sileroFailed = false
        sileroMarkOn = false
        speechChunks = 0
        sileroSpeechChunks = 0
        totalChunks = 0
        rmsPeak = 0f
        rmsSum = 0.0
        firstDecodedUs = -1
        lastDecodedUs = -1
    }

    /** Push one decoded PCM buffer. ptsUs = content time of its first sample. */
    fun pushPcm(buffer: ByteBuffer, ptsUs: Long) {
        if (srcRate == 0 || channels <= 0) return
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val mono = when (pcmEncoding) {
            AudioFormat.ENCODING_PCM_FLOAT -> monoFromFloat(buffer, channels)
            else -> monoFrom16Bit(buffer, channels)
        } ?: return
        if (mono.isEmpty()) return
        if (ptsUs > windowToUs) return

        if (pendingStartUs < 0) pendingStartUs = ptsUs

        val up = resampler.push(mono)
        var k = 0
        while (k < up.size) {
            pending.add(up[k++])
            if (pending.size == 512) {
                binChunk(pendingStartUs)
                pending.clear()
                pendingStartUs += 32_000L // 512 samples @16kHz = 32ms
            }
        }

        if (firstDecodedUs < 0) firstDecodedUs = ptsUs
        // Advance the decoded timeline; a following push's pts re-anchors any
        // pending chunk start (see pushPcm head).
        lastDecodedUs = ptsUs + (mono.size * 1_000_000L) / srcRate
    }

    private fun binChunk(chunkStartUs: Long) {
        val chunk = FloatArray(512) { pending[it] }
        totalChunks++
        // Amplitude stats: distinguishes "VAD never fires on healthy audio"
        // from "decoded PCM is silence".
        var sq = 0f
        for (v in chunk) sq += v * v
        val rms = kotlin.math.sqrt(sq / chunk.size)
        if (rms > rmsPeak) rmsPeak = rms
        rmsSum += rms

        // Energy always runs (cheap RMS + histogram).
        if (energy.process(chunk) >= 0.5f) {
            speechChunks++
            maxBin = mark(bins, chunkStartUs, maxBin)
        }
        // Silero runs alongside when enabled — independent bit set.
        // Part B / R8-3 residual: a runtime ONNX throw must not fail the scan.
        // Zero Silero bins, latch, continue on energy alone.
        if (silero != null && !sileroFailed) {
            try {
                val prob = silero.process(chunk)
                // F6: rising-edge hysteresis (energy path stays flat 0.5).
                // Old rule (prob >= 0.5) marks late on contaminated audio: Silero's
                // ramp through the threshold arrives after true speech onset, so
                // speech bins are biased late proportional to music/CAM bleed.
                // Ground truths: Luther (clean) error < ~0.2s; Lioness (music-dense)
                // +0.46s LATE (engine +0.76 -> user ~+0.30); Spider-WEBRip (CAM)
                // +1.5s LATE (31.80 vs true 30.30).
                val on = markOnOverride ?: MARK_ON
                val off = markOffOverride ?: MARK_OFF
                if (!sileroMarkOn && prob >= on) sileroMarkOn = true
                else if (sileroMarkOn && prob < off) sileroMarkOn = false
                if (sileroMarkOn) {
                    sileroSpeechChunks++
                    maxBinSilero = mark(binsSilero, chunkStartUs, maxBinSilero)
                }
            } catch (t: Throwable) {
                sileroFailed = true
                binsSilero.clear()
                maxBinSilero = -1
                sileroSpeechChunks = 0
                log?.invoke(
                    "vad: Silero THROW (${t.javaClass.simpleName}: ${t.message}) - " +
                        "zeroed silero bins, continuing on energy alone"
                )
            }
        }
    }

    /** Set bits for [chunkStartUs]..+32ms on [target]; return the new max bin index. */
    private fun mark(target: BitSet, chunkStartUs: Long, prevMax: Int): Int {
        var max = prevMax
        val b0 = ((chunkStartUs - anchorUs) / 10_000L).toInt()
        val b1 = ((chunkStartUs - anchorUs + 32_000L) / 10_000L).toInt()
        for (b in b0 until b1) {
            if (b < 0) continue
            target.set(b)
            if (b > max) max = b
        }
        return max
    }

    /** Mid-scan: either VAD marked something (choice happens only at buildSuccess). */
    fun hasSignal(): Boolean = (maxBin >= 0 || maxBinSilero >= 0) && lastDecodedUs > firstDecodedUs

    /** True when decoded content reached the window end. */
    fun windowComplete(): Boolean = lastDecodedUs >= toUs

    /** Approximate wall-clock-independent progress over [fromUs..toUs]. */
    fun progress(fromUs: Long): Float {
        val denom = (toUs - fromUs).coerceAtLeast(1L)
        return (((lastDecodedUs - fromUs).toDouble() / denom)).toFloat().coerceIn(0f, 1f)
    }

    /**
     * Part B end-of-window choice. Runs ONCE when the window is done:
     *   Silero wins iff present, not failed, sileroDuty >= 0.01 AND maxProb >= 0.5.
     *   Dead-model signature (all probs < 0.05) is logged loudly.
     *   Every choice logs both duties + maxProb.
     */
    fun buildSuccess(): ExtractResult.Success? {
        if (lastDecodedUs <= firstDecodedUs) return null
        val sDuty = sileroDuty()
        val eDuty = energyDuty()
        val maxProb = silero?.maxProb ?: 0f
        val choseSilero =
            silero != null && !sileroFailed && sDuty >= 0.01f && maxProb >= 0.5f

        if (silero != null) {
            val latchNote = if (sileroFailed) " [silero-failed-latched]" else ""
            if (choseSilero) {
                log?.invoke(
                    "vad: chose silero (sileroDuty=${"%.3f".format(java.util.Locale.US, sDuty)} " +
                        "energyDuty=${"%.3f".format(java.util.Locale.US, eDuty)} " +
                        "maxProb=${"%.3f".format(java.util.Locale.US, maxProb)})"
                )
            } else {
                log?.invoke(
                    "vad: chose energy (sileroDuty=${"%.3f".format(java.util.Locale.US, sDuty)} " +
                        "energyDuty=${"%.3f".format(java.util.Locale.US, eDuty)} " +
                        "maxProb=${"%.3f".format(java.util.Locale.US, maxProb)}$latchNote)"
                )
            }
            if (maxProb < 0.05f) {
                log?.invoke(
                    "vad: DEAD-MODEL maxProb=${"%.4f".format(java.util.Locale.US, maxProb)} " +
                        "< 0.05 (sileroDuty=${"%.3f".format(java.util.Locale.US, sDuty)} " +
                        "energyDuty=${"%.3f".format(java.util.Locale.US, eDuty)} " +
                        "chunks=$totalChunks)"
                )
            }
        }

        val activeBins = if (choseSilero) binsSilero else bins
        val activeMax = if (choseSilero) maxBinSilero else maxBin
        if (activeMax < 0) return null

        val endUs = minOf(lastDecodedUs, windowToUs)
        val totalBins = (((endUs - anchorUs) + 9_999L) / 10_000L).toInt().coerceAtLeast(activeMax + 1)
        val bytes = SignalPacking.pack(activeBins, totalBins)
        return ExtractResult.Success(
            startSec = anchorUs / 1_000_000.0,
            endSec = endUs / 1_000_000.0,
            signalB64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP),
            bins = totalBins,
            vadChose = if (choseSilero) "silero" else "energy",
            sileroDuty = if (silero != null) sDuty else null,
            energyDuty = eDuty,
            sileroMaxProb = if (silero != null) maxProb else null,
            totalChunks = totalChunks,
        )
    }

    private fun monoFrom16Bit(buffer: ByteBuffer, channels: Int): FloatArray? {
        val shorts = ShortArray(buffer.remaining() / 2)
        buffer.asShortBuffer().get(shorts)
        val frames = shorts.size / channels
        val mono = FloatArray(frames)
        for (i in 0 until frames) {
            var acc = 0f
            for (c in 0 until channels) acc += shorts[i * channels + c] / 32768f
            mono[i] = acc / channels
        }
        return mono
    }

    private fun monoFromFloat(buffer: ByteBuffer, channels: Int): FloatArray? {
        val floats = FloatArray(buffer.remaining() / 4)
        buffer.asFloatBuffer().get(floats)
        val frames = floats.size / channels
        val mono = FloatArray(frames)
        for (i in 0 until frames) {
            var acc = 0f
            for (c in 0 until channels) acc += floats[i * channels + c]
            mono[i] = (acc / channels).coerceIn(-1f, 1f)
        }
        return mono
    }

    companion object {
        /** Keep a little context before/after the window so edge cues still overlap. */
        private const val WINDOW_MARGIN_US = 500_000L

        /**
         * F6: Silero mark-threshold hysteresis (replaces flat prob >= 0.5).
         * Mark ON at >= MARK_ON; stay on until prob < MARK_OFF.
         * Mechanism: on contaminated audio the probability ramp crosses the old
         * 0.5 mark late → speech bins late → offset biased late, proportional
         * to contamination. Three-point ground truth: Luther (clean) < ~0.2s;
         * Lioness (music-dense) +0.46s late (truth ~0.30, was 0.76);
         * Spider-WEBRip (CAM) +1.5s late (31.80 vs true 30.30).
         */
        private const val MARK_ON = 0.35f
        private const val MARK_OFF = 0.25f

        /**
         * F6 escalation (NOT active): onset-of-speech binning — mark the first
         * chunk where prob rises twice consecutively after a below-MARK_OFF run.
         * Flip to true only if F6 undercorrects Lioness/Spider on device.
         */
        private const val ONSET_BINNING = false
    }
}
