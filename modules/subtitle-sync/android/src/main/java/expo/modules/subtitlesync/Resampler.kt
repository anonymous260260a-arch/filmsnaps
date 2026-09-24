package expo.modules.subtitlesync

/**
 * Linear interpolation resampler to 16kHz.
 * Accepts arbitrary source sample rates (e.g. 44100, 48000).
 */
class Resampler(srcRate: Int, private val dstRate: Int = 16000) {
    private var step = srcRate.toDouble() / dstRate
    private var t = 0.0
    private var prev = Float.NaN

    fun reset(srcRate: Int) {
        step = srcRate.toDouble() / dstRate
        t = 0.0
        prev = Float.NaN
    }

    fun push(x: FloatArray): FloatArray {
        if (step == 1.0) return x
        if (prev.isNaN()) prev = x[0]
        val n = x.size
        val out = FloatArray((n / step).toInt() + 2)
        var m = 0
        while (t <= n - 1) {
            val i = t.toInt()
            val frac = (t - i).toFloat()
            val a = if (i == 0) prev else x[i - 1]
            val b = x[i]
            out[m++] = a + (b - a) * frac
            t += step
        }
        t -= n
        prev = x[n - 1]
        return out.copyOf(m)
    }
}
