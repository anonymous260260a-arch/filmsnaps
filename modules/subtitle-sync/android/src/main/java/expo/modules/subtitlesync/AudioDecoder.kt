package expo.modules.subtitlesync

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import androidx.media3.common.Format
import java.nio.ByteBuffer

/**
 * Synchronous MediaCodec audio decoder fed by TrackOutput taps.
 *
 * Sample flow: extractor thread queues encoded samples -> [drain] pushes
 * queued samples into the codec and drains decoded PCM into [SignalCollector].
 * Runs unclocked - as fast as CPU allows - unlike the old headless-player
 * pipeline that was paced by the AudioTrack (4x cap, wall-clock anchors).
 *
 * Recreates the codec when the input format's mime changes (HLS rendition /
 * discontinuity runs); sample-rate / channel changes surface via the decoder's
 * output format change and are forwarded to the collector.
 *
 * Every state transition goes to both logcat ([TAG]) and the injectable
 * [debugSink] so device runs are diagnosable from Metro console alone.
 */
class AudioDecoder(
    private val collector: SignalCollector,
    private val debugSink: (String) -> Unit = {},
) {
    private var codec: MediaCodec? = null
    private var codecMime: String? = null
    private val info = MediaCodec.BufferInfo()
    private val pending = ArrayDeque<QueuedSample>()

    private class QueuedSample(val data: ByteArray, val ptsUs: Long, val flags: Int)

    // Diagnostics
    var samplesQueued = 0L
        private set
    var samplesFed = 0L
        private set
    var outputBuffers = 0L
        private set
    var queuedBytes = 0L
        private set
    var firstQueuedPtsUs = -1L
        private set
    var lastQueuedPtsUs = -1L
        private set
    var formatSeen: Format? = null
        private set

    var error: ExtractResult.Error? = null
        private set

    /** Record the first error (wins over later ones). Callable from taps. */
    fun fail(code: String, message: String) {
        if (error == null) {
            error = ExtractResult.Error(code, message)
            debugSink("decoder ERROR: $code - $message")
        }
    }

    /** Configure (or reconfigure) the decoder for a new audio format. */
    fun onFormat(format: Format): Boolean {
        val mime = format.sampleMimeType
        if (mime == null) {
            debugSink("format: null mime ignored")
            return false
        }
        if (!mime.startsWith("audio/")) {
            return false
        }
        formatSeen = format
        if (codec != null && mime == codecMime) {
            return true
        }

        releaseCodec()
        try {
            val mf = MediaFormat().apply {
                setString(MediaFormat.KEY_MIME, mime)
                if (format.sampleRate > 0) setInteger(MediaFormat.KEY_SAMPLE_RATE, format.sampleRate)
                if (format.channelCount > 0) setInteger(MediaFormat.KEY_CHANNEL_COUNT, format.channelCount)
                if (format.maxInputSize > 0) setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, format.maxInputSize)
                format.initializationData.forEachIndexed { i, csd ->
                    setByteBuffer("csd-$i", ByteBuffer.wrap(csd))
                }
            }
            debugSink(
                "decoder init: mime=$mime rate=${format.sampleRate} ch=${format.channelCount} " +
                    "csd=${format.initializationData.size} lang=${format.language ?: "-"}"
            )
            val c = MediaCodec.createDecoderByType(mime)
            c.configure(mf, null, null, 0)
            c.start()
            codec = c
            codecMime = mime
            debugSink("decoder started OK")
            return true
        } catch (e: Exception) {
            releaseCodec()
            fail("unsupported-codec", "no decoder for $mime (${e.message})")
            return false
        }
    }

    fun queueSample(data: ByteArray, ptsUs: Long, flags: Int) {
        if (codec == null) {
            // Should not happen (tap format precedes samples) - but never lose
            // the signal to it silently: report once via the first-drop log.
            if (samplesQueued == 0L && queuedBytes == 0L) {
                debugSink("DROP sample pts=$ptsUs size=${data.size}: decoder not configured yet")
            }
            return
        }
        if (samplesQueued == 0L) {
            debugSink("first audio sample queued: pts=$ptsUs size=${data.size}")
        }
        samplesQueued++
        queuedBytes += data.size
        if (firstQueuedPtsUs < 0) firstQueuedPtsUs = ptsUs
        lastQueuedPtsUs = ptsUs
        pending.addLast(QueuedSample(data, ptsUs, flags))
    }

    fun hasPending(): Boolean = pending.isNotEmpty()

    /**
     * Feed up to `maxIn` queued samples into the codec and drain decoded
     * output. Returns true when the collector's window is complete.
     */
    fun drain(maxIn: Int = 4): Boolean {
        val c = codec ?: return false

        var fed = 0
        while (fed < maxIn) {
            val s = pending.firstOrNull() ?: break
            val inIdx = c.dequeueInputBuffer(0L)
            if (inIdx < 0) break
            val ib = c.getInputBuffer(inIdx)!!
            if (s.data.size > ib.capacity()) {
                fail(
                    "decode-failed",
                    "sample ${s.data.size}B exceeds input buffer ${ib.capacity()}B",
                )
                return false
            }
            ib.clear()
            ib.put(s.data)
            c.queueInputBuffer(inIdx, 0, s.data.size, s.ptsUs, s.flags)
            pending.removeFirst()
            samplesFed++
            fed++
        }

        pumpOutputs(c)
        return collector.windowComplete()
    }

    private fun pumpOutputs(c: MediaCodec) {
        while (true) {
            val outIdx = c.dequeueOutputBuffer(info, 0L)
            when {
                outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val of = c.outputFormat
                    val enc = if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        of.getInteger(MediaFormat.KEY_PCM_ENCODING)
                    } else {
                        AudioFormat.ENCODING_PCM_16BIT
                    }
                    val rate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    val ch = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    debugSink("decoder output format: rate=$rate ch=$ch enc=$enc")
                    collector.onFormatChanged(rate, ch, enc)
                }
                outIdx >= 0 -> {
                    outputBuffers++
                    if (outputBuffers == 1L) {
                        debugSink("first decoded PCM: pts=${info.presentationTimeUs} size=${info.size}")
                    }
                    val ob = c.getOutputBuffer(outIdx)!!
                    if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_DECODE_ONLY == 0) {
                        ob.position(info.offset)
                        ob.limit(info.offset + info.size)
                        collector.pushPcm(ob, info.presentationTimeUs)
                    }
                    c.releaseOutputBuffer(outIdx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
                else -> return // TRY_AGAIN / nothing yet
            }
        }
    }

    /** Signal end of stream and drain everything remaining. */
    fun finish() {
        val c = codec ?: return
        while (pending.isNotEmpty() && error == null) {
            val inIdx = c.dequeueInputBuffer(10_000)
            if (inIdx < 0) {
                pumpOutputs(c)
                continue
            }
            val s = pending.first()
            val ib = c.getInputBuffer(inIdx)!!
            ib.clear()
            ib.put(s.data)
            c.queueInputBuffer(inIdx, 0, s.data.size, s.ptsUs, s.flags)
            pending.removeFirst()
            samplesFed++
        }
        if (error == null) {
            val inIdx = c.dequeueInputBuffer(10_000)
            if (inIdx >= 0) {
                c.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            }
        }
        var idle = 0
        while (idle < 300) {
            val outIdx = c.dequeueOutputBuffer(info, 10_000)
            when {
                outIdx >= 0 -> {
                    outputBuffers++
                    val ob = c.getOutputBuffer(outIdx)!!
                    if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_DECODE_ONLY == 0) {
                        ob.position(info.offset)
                        ob.limit(info.offset + info.size)
                        collector.pushPcm(ob, info.presentationTimeUs)
                    }
                    c.releaseOutputBuffer(outIdx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    idle = 0
                }
                outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> pumpOutputs(c)
                else -> idle++
            }
        }
    }

    fun releaseCodec() {
        try { codec?.stop() } catch (_: Exception) {}
        try { codec?.release() } catch (_: Exception) {}
        codec = null
        codecMime = null
        pending.clear()
    }

    fun diagnostics(): String =
        "queued=${samplesQueued}(${queuedBytes}B) fed=$samplesFed out=$outputBuffers " +
            "pts=[${firstQueuedPtsUs}..${lastQueuedPtsUs}] " +
            "vad: energyDuty=${collector.energyDuty()} sileroDuty=${collector.sileroDuty()} " +
            "chunks=${collector.totalChunks} span=${collector.decodedSpanUs() / 1000}ms"

    companion object {
        private const val TAG = "SubSyncFast"
    }
}
