package expo.modules.subtitlesync

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

sealed class ExtractResult {
    data class Success(
        val startSec: Double,
        val endSec: Double,
        val signalB64: String,
        val bins: Int,
        /** R8-1/R8-3: end-of-window VAD choice + diagnostics (null when unavailable). */
        val vadChose: String? = null,       // "silero" | "energy"
        val sileroDuty: Float? = null,
        val energyDuty: Float? = null,
        val sileroMaxProb: Float? = null,
        val totalChunks: Long? = null,
    ) : ExtractResult()
    data class Error(val code: String, val message: String) : ExtractResult()
}

class AudioExtractJob(
    private val context: Context,
    private val uri: String,
    private val headers: Map<String, String>,
    private val fromSec: Double,
    private val toSec: Double,
    private val useSilero: Boolean,
    private val onProgress: (Float) -> Unit,
    private val onResult: (ExtractResult) -> Unit,
) {
    private val cancelled = AtomicBoolean(false)
    fun cancel() { cancelled.set(true) }

    fun start() = CoroutineScope(Dispatchers.Default).launch {
        val r = try {
            extract()
        } catch (t: Throwable) {
            if (cancelled.get()) ExtractResult.Error("cancelled", "cancelled")
            else ExtractResult.Error("decode-failed", t.message ?: "decode failed")
        }
        onResult(r)
    }

    /**
     * Framework error messages vary by OEM/HTTP stack — classification is best-effort.
     * JS re-resolves + retries once on either code for remote sources, so a
     * mis-classification only changes the user-facing message.
     */
    private fun classifyNetworkError(e: Exception): ExtractResult.Error {
        val msg = (e.message ?: "").lowercase()
        val expired = listOf("403", "401", "410", "unauthorized", "forbidden", "authentication")
            .any { msg.contains(it) }
        return if (expired) ExtractResult.Error("expired-url", "source rejected request")
        else ExtractResult.Error("network", msg.ifEmpty { "network error" })
    }

    private fun extract(): ExtractResult {
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        val isRemote = uri.startsWith("http")
        try {
            // Open source
            try {
                val androidHeaders = headers.mapValues { it.value }
                ex.setDataSource(context, Uri.parse(uri), androidHeaders)
            } catch (e: Exception) {
                return if (isRemote) classifyNetworkError(e)
                else ExtractResult.Error("decode-failed", e.message ?: "cannot open source")
            }

            // Find audio track
            var trackIdx = -1
            var format: MediaFormat? = null
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("audio/")) {
                    trackIdx = i
                    format = f
                    break
                }
            }
            if (trackIdx < 0) return ExtractResult.Error("no-audio-track", "no audio track")

            ex.selectTrack(trackIdx)
            val inputMime = format!!.getString(MediaFormat.KEY_MIME)!!
            ex.seekTo((fromSec * 1_000_000).toLong(), MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            // Seek must land on a real sample. Converts an unseekable source into
            // a clean error instead of queueing a zero-length pts=-1 buffer that
            // crashes the codec (ArrayIndexOutOfBoundsException: length=0; index=-1).
            if (ex.sampleTime < 0) {
                return ExtractResult.Error("decode-failed", "seek failed: no sample at target (source not seekable)")
            }

            // Create decoder
            try {
                codec = MediaCodec.createDecoderByType(inputMime)
            } catch (e: Exception) {
                return ExtractResult.Error("unsupported-codec", "no decoder for $inputMime")
            }
            codec.configure(format, null, null, 0)
            codec.start()

            var srcRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

            val vad: Vad = if (useSilero) {
                SileroVad(context)
            } else {
                EnergyVad()
            }
            vad.reset()
            val accumulator = SignalAccumulator(srcRate, vad)
            var startSec = -1.0
            var lastProgress = 0f
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false

            // Stall watchdog (not fixed deadline):
            // Remote: 300s connect/moov + 1x realtime decode
            // Local: 120s setup + 0.25x realtime decode
            val stallMs = if (isRemote) {
                300_000L + ((toSec - fromSec) * 1_000).toLong()
            } else {
                120_000L + ((toSec - fromSec) * 250).toLong()
            }
            var lastOutputAt = System.currentTimeMillis()

            fun consumePcm(buf: ByteBuffer, ptsUs: Long) {
                buf.order(ByteOrder.LITTLE_ENDIAN)
                val shorts = ShortArray(buf.remaining() / 2)
                buf.asShortBuffer().get(shorts)
                val frames = shorts.size / channels
                val mono = FloatArray(frames)
                for (i in 0 until frames) {
                    var acc = 0f
                    for (c in 0 until channels) acc += shorts[i * channels + c] / 32768f
                    mono[i] = acc / channels
                }
                if (startSec < 0) startSec = ptsUs / 1_000_000.0
                accumulator.pushMono(mono)
            }

            // Main decode loop
            while (!outputDone && !cancelled.get()) {
                if (System.currentTimeMillis() - lastOutputAt > stallMs) {
                    return ExtractResult.Error("timeout", "decode stall watchdog")
                }

                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val ib = codec.getInputBuffer(inIdx)!!
                        val pts = ex.sampleTime
                        // sampleTime=-1 means the extractor lost its position
                        // (failed seek / dead HTTP source) — never queue that.
                        if (pts < 0) {
                            return ExtractResult.Error("decode-failed", "extractor lost sample position (sampleTime=-1)")
                        }
                        val reached = pts > toSec * 1_000_000
                        if (!reached) {
                            val n = ex.readSampleData(ib, 0)
                            if (n < 0) {
                                codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else if (n == 0) {
                                return ExtractResult.Error("decode-failed", "readSampleData returned 0")
                            } else if (n > ib.capacity()) {
                                return ExtractResult.Error("decode-failed", "sample $n exceeds codec input buffer ${ib.capacity()}")
                            } else {
                                codec.queueInputBuffer(inIdx, 0, n, pts, ex.sampleFlags)
                                ex.advance()
                            }
                        } else {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        }
                    }
                }

                when (val outIdx = codec.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val f = codec.outputFormat
                        srcRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        accumulator.resetSourceRate(srcRate)
                    }
                    MediaCodec.INFO_TRY_AGAIN_LATER -> {}
                    else -> if (outIdx >= 0) {
                        val ob = codec.getOutputBuffer(outIdx)!!
                        consumePcm(ob, info.presentationTimeUs)
                        codec.releaseOutputBuffer(outIdx, false)
                        lastOutputAt = System.currentTimeMillis()
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                        val p = (((info.presentationTimeUs / 1e6) - fromSec) / (toSec - fromSec))
                            .toFloat().coerceIn(0f, 1f)
                        if (p - lastProgress > 0.02f) {
                            lastProgress = p
                            onProgress(p)
                        }
                    }
                }
            }

            if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")

            val out = accumulator.output(startSec)
            return ExtractResult.Success(
                startSec = startSec,
                endSec = out.endSec,
                signalB64 = out.signalB64,
                bins = out.bins,
                // R8-3 local path: single-VAD (no dual bins) — report the VAD in use.
                vadChose = if (useSilero) "silero" else "energy",
                energyDuty = null,
                sileroMaxProb = if (useSilero && vad is SileroVad) vad.maxProb else null,
                totalChunks = null,
            )
        } finally {
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            ex.release()
        }
    }
}
