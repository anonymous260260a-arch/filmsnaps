package expo.modules.subtitlesync

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Headless Media3 player for HLS (`.m3u8`) sources. Plays the stream muted at
 * playback speed with video/text disabled and the lowest audio rendition, taps
 * decoded PCM through [CaptureAudioProcessor] into a windowed
 * [SignalAccumulator] (content-time aligned 100Hz speech bins), and stops when
 * the accumulation window completes.
 *
 * The list URL is probed first via [PlaylistProbe] so live/malformed/unchunked
 * playlists fail fast with clean errors before a player is even built.
 */
@UnstableApi
class HlsScanJob(
    private val context: Context,
    private val uri: String,
    private val headers: Map<String, String>,
    private val fromSec: Double,
    private val toSec: Double,
    private val speed: Float,
    private val useSilero: Boolean,
    private val onProgress: (Float) -> Unit,
    private val onResult: (ExtractResult) -> Unit,
) : ScanJob {
    companion object {
        /** No seek-aware variant: clamp-to-0 tolerable preroll, else "unseekable". */
        private const val PREROLL_MAX_SEC = 180.0
        /** No decoded PCM for this long while playing → stall timeout. */
        private const val STALL_MS = 90_000L
        private const val TICK_MS = 500L
    }

    private val cancelled = AtomicBoolean(false)
    private val finished = AtomicBoolean(false)
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null
    private var player: ExoPlayer? = null

    private val vad: Vad = if (useSilero) SileroVad(context) else EnergyVad()
    private val accumulator = SignalAccumulator(48_000, vad, windowSec = toSec - fromSec)

    /** Tap → wall-clock + content-anchor updates. Runs on the playback/audio
     *  thread — NEVER touch the player here (ExoPlayer throws
     *  IllegalStateException on off-thread access, which becomes a fatal
     *  PlaybackException). Wall-clock updates are thread-safe; the
     *  content-anchor read is posted to the job looper. */
    private val capture = CaptureAudioProcessor(accumulator) { first ->
        val now = System.currentTimeMillis()
        lastPcmWallMs = now
        if (first && startContentSec < 0) {
            handler?.post {
                if (startContentSec < 0) {
                    startContentSec = player?.currentPosition?.coerceAtLeast(0)?.div(1000.0) ?: fromSec
                }
            }
        }
    }

    @Volatile private var lastPcmWallMs = 0L
    @Volatile private var startContentSec = -1.0
    @Volatile private var readyAtWallMs = 0L

    override fun cancel() {
        cancelled.set(true)
        handler?.post {
            finish(ExtractResult.Error("cancelled", "cancelled"))
        }
    }

    fun start() {
        android.util.Log.i("SubSyncHls", "scan start $uri from=${fromSec}s to=${toSec}s speed=${speed}x on " +
            "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
        handlerThread = HandlerThread("SubSyncHls").also { it.start() }
        handler = Handler(handlerThread!!.looper)
        // Probe the playlist off the looper (network I/O with connect/read
        // timeouts), then hand off to the player thread for setup.
        Thread {
            if (cancelled.get()) return@Thread
            val probe = try {
                PlaylistProbe.probe(uri, headers)
            } catch (t: Throwable) {
                Result.failure(
                    PlaylistProbe.PlaylistError("network", t.message ?: "probe failed")
                )
            }
            handler?.post { setup(probe) }
        }.also { it.isDaemon = true }.start()
    }

    private fun setup(probe: Result<PlaylistInfo>) {
        if (cancelled.get()) return
        probe.fold(
            onSuccess = { info -> buildPlayer(info) },
            onFailure = { err ->
                val pe = err as? PlaylistProbe.PlaylistError
                finish(
                    ExtractResult.Error(
                        pe?.code ?: "network",
                        pe?.message ?: "probe failed"
                    )
                )
            }
        )
    }

    private fun buildPlayer(info: PlaylistInfo) {
        try {
            if (info.live) {
                finish(ExtractResult.Error("live-unsupported", "live streams aren't supported"))
                return
            }
            if (info.drmProtected) {
                finish(ExtractResult.Error("drm-unsupported", "drm protected stream"))
                return
            }

            val trackSelector = DefaultTrackSelector(context).apply {
                parameters = DefaultTrackSelector.Parameters.Builder(context!!)
                    .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true)
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                    .setForceLowestBitrate(true)
                    .build()
            }

            val renderers = object : DefaultRenderersFactory(context) {
                override fun buildAudioSink(
                    context: android.content.Context,
                    enableFloatOutput: Boolean,
                    enableAudioTrackPlaybackParams: Boolean,
                ): AudioSink = DefaultAudioSink.Builder(context)
                    .setAudioProcessors(arrayOf(capture))
                    .build()
            }

            val dataSourceFactory = DefaultHttpDataSource.Factory().apply {
                setConnectTimeoutMs(10_000)
                setReadTimeoutMs(15_000)
                if (headers.isNotEmpty()) setDefaultRequestProperties(headers)
                setUserAgent(headers["User-Agent"] ?: "filmsnaps")
            }

            val item = MediaItem.Builder()
                .setUri(uri)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .build()

            val p = ExoPlayer.Builder(context, renderers)
                .setTrackSelector(trackSelector)
                .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
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
            handler?.postDelayed(tick, TICK_MS)
        } catch (e: Exception) {
            finish(ExtractResult.Error("decode-failed", e.message ?: "hls scan setup failed"))
        }
    }

    private fun onReady() {
        val p = player ?: return
        readyAtWallMs = System.currentTimeMillis()
        val landed = p.currentPosition.coerceAtLeast(0) / 1000.0
        val preroll = fromSec - landed
        if (preroll > PREROLL_MAX_SEC) {
            finish(
                ExtractResult.Error(
                    "unseekable",
                    "no seek index; window starts ${preroll.toInt()}s into an unseekable stream"
                )
            )
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (finished.get() || cancelled.get()) return
            val now = System.currentTimeMillis()

            // Stall watchdog: playing but no decoded PCM for a while. Dead-guard:
            // with zero PCM ever, measure from READY, not from last PCM.
            val baseMs = if (accumulator.out16k() > 0) lastPcmWallMs else readyAtWallMs
            if (readyAtWallMs > 0 && baseMs > 0 && now - baseMs > STALL_MS) {
                finish(ExtractResult.Error("timeout", "no audio output for ${STALL_MS / 1000}s"))
                return
            }

            // Window complete → done.
            val windowDone = accumulator.finished ||
                (startContentSec >= 0 && startContentSec + accumulator.contentSec() >= toSec)
            if (windowDone) {
                finishWithCurrent("window-complete")
                return
            }

            val contentPos = if (startContentSec >= 0) {
                startContentSec + accumulator.contentSec()
            } else {
                player?.currentPosition?.coerceAtLeast(0)?.div(1000.0) ?: fromSec
            }
            val denom = (toSec - fromSec).coerceAtLeast(1.0)
            onProgress(((contentPos - fromSec) / denom).toFloat().coerceIn(0f, 1f))
            handler?.postDelayed(this, TICK_MS)
        }
    }

    private fun finishWithCurrent(reason: String) {
        if (startContentSec < 0 || accumulator.out16k() <= 0) {
            finish(ExtractResult.Error("no-audio-track", "no audio decoded ($reason)"))
            return
        }
        val out = accumulator.output(startContentSec)
        finish(
            ExtractResult.Success(
                startSec = startContentSec,
                endSec = out.endSec,
                signalB64 = out.signalB64,
                bins = out.bins,
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

    /** Cause-chain description for on-device self-diagnosis: error code name,
     *  device, then up to 6 "class: message" frames. */
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
                ExtractResult.Error("expired-url", "http $httpStatus — $detail")
            e.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ||
                httpStatus != null ->
                ExtractResult.Error("network", "network error — $detail")
            e.errorCode == PlaybackException.ERROR_CODE_DRM_SCHEME_UNSUPPORTED ||
                e.errorCode == PlaybackException.ERROR_CODE_DRM_CONTENT_ERROR ||
                e.errorCode == PlaybackException.ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED ->
                ExtractResult.Error("drm-unsupported", "drm protected stream — $detail")
            e.errorCode == PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED ||
                e.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ->
                ExtractResult.Error("unsupported-format", "unrecognized playlist — $detail")
            e.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
                ExtractResult.Error("unsupported-codec", "no decoder for audio track — $detail")
            // Explicit mapping previously lost in the catch-all: treat decoding /
            // audio-track failures as decode-failed with the full cause chain so
            // every mystery (incl. "Unexpected runtime error") is self-explanatory.
            e.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED ||
                e.errorCode == PlaybackException.ERROR_CODE_UNSPECIFIED ->
                ExtractResult.Error("decode-failed", detail)
            else -> ExtractResult.Error("decode-failed", detail)
        }
    }
}