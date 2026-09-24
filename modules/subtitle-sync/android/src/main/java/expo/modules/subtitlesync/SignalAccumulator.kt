package expo.modules.subtitlesync

import android.util.Base64
import java.util.BitSet

class SignalOutput(val signalB64: String, val bins: Int, val endSec: Double)

/**
 * Converts mono float PCM @ srcRate into the 100Hz bit-packed speech signal.
 * The output bins are indexed in *content* time, not sample time.
 *
 * @param contentScale 1.0 = PCM is original-rate (progressive source, no speed
 *                     tap). >1 (= playback speed) = PCM is time-compressed by
 *                     the HLS player; sample-time bin math is divided by
 *                     contentScale so bins stay aligned to content time.
 */
class SignalAccumulator(
    srcRate: Int,
    private val vad: Vad,
    private val windowSec: Double? = null,
    private val contentScale: Double = 1.0,
) {
    private val resampler = Resampler(srcRate)
    private val bins = BitSet()
    private val window = ArrayList<Float>(512)
    @Volatile private var totalOut16k = 0L
    @Volatile var finished = false
        private set

    fun contentSec(): Double = totalOut16k / 16000.0 / contentScale

    fun out16k(): Long = totalOut16k

    /** Re-target the input resampler when the decoder reports a new sample rate (keeps bins). */
    fun resetSourceRate(srcRate: Int) = resampler.reset(srcRate)

    /** Returns true when the accumulation window is complete. */
    fun pushMono(mono: FloatArray): Boolean {
        val up = resampler.push(mono)
        var k = 0
        while (k < up.size) {
            window.add(up[k++])
            if (window.size == 512) {
                val chunk = FloatArray(512) { window[it] }
                window.clear()
                if (vad.process(chunk) >= 0.5f) {
                    val b0 = (totalOut16k / (160 * contentScale)).toInt()
                    val b1 = ((totalOut16k + 512) / (160 * contentScale)).toInt()
                    for (b in b0 until maxOf(b1, b0 + 1)) bins.set(b)
                }
                totalOut16k += 512
            }
        }
        if (windowSec != null && contentSec() >= windowSec) finished = true
        return finished
    }

    fun output(startSec: Double): SignalOutput {
        val totalBins = ((totalOut16k / contentScale + 159) / 160).toInt()
        return SignalOutput(
            signalB64 = Base64.encodeToString(SignalPacking.pack(bins, totalBins), Base64.NO_WRAP),
            bins = totalBins,
            endSec = startSec + contentSec(),
        )
    }
}