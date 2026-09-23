package expo.modules.subtitlesync

import java.util.BitSet

/**
 * Single source of truth for the signal schema on Android (§1.3): the emitted
 * byte array must be EXACTLY ceil(bins/8) bytes.
 *
 * BitSet.toByteArray() trims trailing zero bytes (only up to the highest set
 * bit) while `bins` is a sample-count forecast (ceil(totalOut16k/160)), so a
 * window ending in silence ships a short array. Pad out to the declared width —
 * every emitter (AudioExtractJob, SignalCollector/FastScanJob) goes through this.
 */
object SignalPacking {
    /** Pad [bits]'s BitSet.toByteArray() representation to ceil(bins/8) bytes. */
    fun pack(bits: BitSet, bins: Int): ByteArray {
        val width = (bins + 7) / 8
        val out = ByteArray(width)
        val packed = bits.toByteArray()
        check(packed.size <= out.size) { "packed ${packed.size}B exceeds declared $bins bins" }
        packed.copyInto(out)
        return out
    }
}