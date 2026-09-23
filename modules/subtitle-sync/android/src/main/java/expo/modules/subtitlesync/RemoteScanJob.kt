package expo.modules.subtitlesync

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import expo.modules.video.PlayerHttp
import expo.modules.video.utils.CustomExtractorsFactory
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.BitSet
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Headless Media3 player that "plays" a remote stream muted at high speed with
 * video/text disabled, taps the decoded PCM through [TeeAudioProcessor], and
 * accumulates a VAD speech signal - the same machinery that already plays these
 * URLs in the app, so HTTP/range/redirect/extractor behavior matches playback.
 *
 * Local files must use [AudioExtractJob] (framework extractor, up to 10x
 * realtime); this job is for remote sources where MediaExtractor's HTTP stack is
 * untrustworthy (Matroska Cues over HTTP, flaky range CDNs).
 *
 * Time anchor: the first PCM's content position is the post-seek player
 * position captured at READY ([PcmSink.landedSec]) - NOT a wall-clock
 * estimate. Buffering after READY used to shift startSec forward and smear
 * the whole signal (wrong offsets, collapsing confidence). Bins are content-
 * time aligned: playback speed changes delivery rate, not frame->time mapping.
 */
@UnstableApi
class RemoteScanJob(
    private val context: Context,
    private val uri: String,
    private val headers: Map<String, String>,
    private val fromSec: Double,
    private val toSec: Double,
    private val speed: Float,
    private val useSilero: Boolean,
    private val container: String, // "hls" | "progressive"
    private val onProgress: (Float) -> Unit,
    private val onResult: (ExtractResult) -> Unit,
) : ScanJob {
    companion object {
        /** No-Cues files: seekTo clamps to 0; cap sequential preroll we will tolerate. */
        private const val PREROLL_MAX_SEC = 180.0
        /** No decoded PCM for this long while the player is live -> stall timeout. */
        private const val STALL_MS = 90_000L
        private const val TICK_MS = 500L
    }

    private val cancelled = AtomicBoolean(false)
    private val finished = AtomicBoolean(false)
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null
    private var player: ExoPlayer? = null
    private val sink = PcmSink()

    override fun cancel() {
        cancelled.set(true)
        handler?.post {
            finish(ExtractResult.Error("cancelled", "cancelled"))
        }
    }

    fun start() {
        android.util.Log.i("SubSyncScan", "scan start $uri from=${fromSec}s to=${toSec}s speed=${speed}x on " +
            "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
        handlerThread = HandlerThread("SubSyncScan").also { it.start() }
        handler = Handler(handlerThread!!.looper)
        handler!!.post { setup() }
    }

    private fun setup() {
        if (cancelled.get()) return
        try {
            val trackSelector = DefaultTrackSelector(context!!).apply {
                parameters = DefaultTrackSelector.Parameters.Builder(context!!)
                    .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true)
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                    .build()
            }

            // media3 1.8: audio processors live on the audio sink; the renderers
            // factory gets it via buildAudioSink. Tee runs after decode - our tap.
            val tee = TeeAudioProcessor(sink)
            val renderers = object : DefaultRenderersFactory(context!!) {
                override fun buildAudioSink(
                    context: android.content.Context,
                    enableFloatOutput: Boolean,
                    enableAudioTrackPlaybackParams: Boolean,
                ): androidx.media3.exoplayer.audio.AudioSink =
                    DefaultAudioSink.Builder(context)
                        .setAudioProcessors(arrayOf(tee))
                        .build()
            }

            // Timeouts live on the shared OkHttpClient (PlayerHttp.client) - the
            // Factory has no setters in 1.8.
            val dataSourceFactory = OkHttpDataSource.Factory(PlayerHttp.client).apply {
                if (headers.isNotEmpty()) setDefaultRequestProperties(headers)
                setUserAgent(headers["User-Agent"] ?: "filmsnaps")
            }

            val item = if (container == "hls") {
                MediaItem.Builder().setUri(uri).setMimeType(MimeTypes.APPLICATION_M3U8).build()
            } else {
                MediaItem.Builder().setUri(uri).build() // ProgressiveMediaSource sniffs the header
            }

            val p = ExoPlayer.Builder(context!!, renderers)
                .setTrackSelector(trackSelector)
                .setMediaSourceFactory(
                    DefaultMediaSourceFactory(dataSourceFactory, CustomExtractorsFactory())
                )
                .setLooper(handler!!.looper)
                .build()
            player = p
            p.setAudioAttributes(AudioAttributes.DEFAULT, false)
            p.volume = 0f
            p.setPlaybackSpeed(speed)
            p.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    when (state) {
                        Player.STATE_READY -> onReady()
                        Player.STATE_ENDED -> finishWithCurrent("ended")
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    finish(classify(error))
                }
            })
            p.setMediaItem(item)
            p.seekTo((fromSec * 1000).toLong())
            p.prepare()
            p.play()
            handler!!.postDelayed(tick, TICK_MS)
        } catch (e: Exception) {
            finish(ExtractResult.Error("decode-failed", e.message ?: "scan setup failed"))
        }
    }

    private fun onReady() {
        val p = player ?: return
        val landed = p.currentPosition.coerceAtLeast(0) / 1000.0
        val preroll = fromSec - landed
        if (preroll > 45) {
            // Diagnostics: providers differ in how far their seeks actually land
            // from the requested position; over-clamping degrades correlation.
            android.util.Log.i(
                "SubSyncScan",
                "preroll %.1fs (asked %.1fs, landed %.1fs)".format(preroll, fromSec, landed),
            )
        }
        if (preroll > PREROLL_MAX_SEC) {
            // Seek clamped to 0 on an unseekable (no-Cues) stream - the window
            // is unreachable sequentially within our bandwidth/time budget.
            finish(
                ExtractResult.Error(
                    "unseekable",
                    "no seek index; window starts ${preroll.toInt()}s into an unseekable stream"
                )
            )
            return
        }
        sink.landedSec = landed
        sink.readyAtWallMs = System.currentTimeMillis()
        sink.armed = true
    }

    private val tick = object : Runnable {
        override fun run() {
            if (finished.get() || cancelled.get()) return
            val contentPos = sink.contentPositionSec()
            // Dead-guard: with zero PCM ever, measure from READY, not from last PCM
            // (which stays 0 and would defeat the watchdog forever).
            val baseMs = if (sink.totalOut16k > 0) sink.lastPcmWallMs else sink.readyAtWallMs
            val elapsedWall = System.currentTimeMillis() - baseMs

            if (sink.armed && elapsedWall > STALL_MS) {
                finish(ExtractResult.Error("timeout", "no audio output for ${STALL_MS / 1000}s"))
                return
            }

            if (sink.startSec >= 0 && contentPos >= toSec) {
                finishWithCurrent("target-reached")
                return
            }

            val denom = (toSec - fromSec).coerceAtLeast(1.0)
            val progress = ((contentPos - fromSec) / denom).toFloat().coerceIn(0f, 1f)
            onProgress(progress)
            handler?.postDelayed(this, TICK_MS)
        }
    }

    private fun finishWithCurrent(reason: String) {
        if (sink.startSec < 0 || sink.totalOut16k <= 0) {
            finish(ExtractResult.Error("no-audio-track", "no audio decoded ($reason)"))
            return
        }
        val totalBins = ((sink.totalOut16k + 159) / 160).toInt()
        val bytes = SignalPacking.pack(sink.bins, totalBins)
        finish(
            ExtractResult.Success(
                startSec = sink.startSec,
                endSec = sink.startSec + sink.totalOut16k / 16000.0,
                signalB64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                bins = totalBins,
                // Retired path (FastScanJob owns production) — minimal verdict fields.
                vadChose = if (useSilero) "silero" else "energy",
            )
        )
    }

    private fun finish(r: ExtractResult) {
        if (!finished.compareAndSet(false, true)) return
        handler?.removeCallbacks(tick)
        try {
            player?.stop()
            player?.release()
        } catch (_: Exception) {}
        player = null
        handlerThread?.quitSafely()
        handlerThread = null
        handler = null
        onResult(if (cancelled.get()) ExtractResult.Error("cancelled", "cancelled") else r)
    }

    /** Cause-chain description: error code name, device, then a "class: message"
     *  frame chain - makes every future playback failure self-explaining. */
    private fun describe(e: PlaybackException): String = buildString {
        append(PlaybackException.getErrorCodeName(e.errorCode))
        append(" [${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}]")
        var c: Throwable? = e
        var d = 0
        while (c != null && d < 6) {
            append(" <- ").append(c.javaClass.simpleName).append(": ").append(c.message)
            c = c.cause
            d++
        }
    }

    private fun classify(e: PlaybackException): ExtractResult.Error {
        var httpStatus: Int? = null
        var cause: Throwable? = e.cause
        while (cause != null) {
            if (cause is HttpDataSource.InvalidResponseCodeException) {
                httpStatus = cause.responseCode
                break
            }
            cause = cause.cause
        }
        val detail = describe(e)
        return when {
            httpStatus == 401 || httpStatus == 403 || httpStatus == 410 ->
                ExtractResult.Error("expired-url", "http $httpStatus - $detail")
            e.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ||
                httpStatus != null ->
                ExtractResult.Error("network", "network error - $detail")
            e.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
                e.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES ->
                ExtractResult.Error("unsupported-codec", "no decoder for audio track - $detail")
            e.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ||
                e.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED ||
                e.errorCode == PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED ->
                ExtractResult.Error("unsupported-format", "unrecognized container - $detail")
            e.errorCode == PlaybackException.ERROR_CODE_DRM_SCHEME_UNSUPPORTED ||
                e.errorCode == PlaybackException.ERROR_CODE_DRM_CONTENT_ERROR ||
                e.errorCode == PlaybackException.ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED ->
                ExtractResult.Error("decode-failed", "drm protected stream - $detail")
            // Decoding/audio-track failures: decode-failed with full cause chain.
            e.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_UNSPECIFIED ->
                ExtractResult.Error("decode-failed", detail)
            else -> ExtractResult.Error("decode-failed", detail)
        }
    }

    /**
     * Receives decoded content PCM (tap - the real audio sink output is muted/unused),
     * downmixes, resamples to 16k, runs VAD, and sets one bit per 10ms bin.
     * Content position = post-seek player position at READY (landedSec), then
     * + 16k-frames/16000 as PCM arrives. Bins are content-time aligned:
     * playback speed changes delivery rate, not the frame->time mapping.
     */
    inner class PcmSink : TeeAudioProcessor.AudioBufferSink {
        @Volatile var armed = false
        /** Content-time position the decoder starts from (post-seek, set at READY). */
        @Volatile var landedSec = 0.0
        @Volatile var readyAtWallMs = 0L
        @Volatile var lastPcmWallMs = 0L

        var startSec = -1.0
        var totalOut16k = 0L
        val bins = BitSet()

        private var srcRate = 0
        private var channels = 0
        private var encoding = C.ENCODING_PCM_16BIT
        private var resampler = Resampler(48_000)
        private val vad: Vad = if (useSilero) SileroVad(context) else EnergyVad()
        private val window = ArrayList<Float>(512)

        init { vad.reset() }

        fun contentPositionSec(): Double {
            if (startSec < 0) return fromSec
            return startSec + totalOut16k / 16000.0
        }

        override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
            if (srcRate != sampleRateHz || channels != channelCount || this.encoding != encoding) {
                srcRate = sampleRateHz
                channels = channelCount
                this.encoding = encoding
                resampler.reset(sampleRateHz)
                window.clear()
            }
        }

        override fun handleBuffer(buffer: ByteBuffer) {
            if (!armed || finished.get() || cancelled.get()) return
            val now = System.currentTimeMillis()
            lastPcmWallMs = now
            if (startSec < 0) {
                // First PCM plays at the post-seek position captured at READY.
                // No wall-clock estimation: buffering gaps must not shift the
                // signal's time anchor.
                startSec = landedSec
                android.util.Log.i("SubSyncScan", "first PCM anchored at %.2fs".format(startSec))
            }

            buffer.order(ByteOrder.LITTLE_ENDIAN)
            val mono = when (encoding) {
                C.ENCODING_PCM_FLOAT -> monoFromFloat(buffer)
                else -> monoFrom16Bit(buffer)
            } ?: return

            val up = resampler.push(mono)
            var k = 0
            while (k < up.size) {
                window.add(up[k++])
                if (window.size == 512) {
                    val chunk = FloatArray(512) { window[it] }
                    window.clear()
                    val prob = vad.process(chunk)
                    if (prob >= 0.5f) {
                        val b0 = (totalOut16k / 160).toInt()
                        val b1 = ((totalOut16k + 512) / 160).toInt()
                        for (b in b0 until b1) bins.set(b)
                    }
                    totalOut16k += 512
                }
            }
        }

        private fun monoFrom16Bit(buffer: ByteBuffer): FloatArray? {
            if (channels <= 0) return null
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

        private fun monoFromFloat(buffer: ByteBuffer): FloatArray? {
            if (channels <= 0) return null
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
    }
}
