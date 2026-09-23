package expo.modules.subtitlesync

import android.content.Context
import android.os.SystemClock
import androidx.media3.common.C
import expo.modules.video.utils.PlayerAudioTap
import java.nio.ByteBuffer

/**
 * Stage B: live watch-sync collector. Sits on the playback PCM tap
 * ([PlayerAudioTap.listener]) and bins content-time speech into a rolling
 * [SignalCollector] window while the user watches — no separate fetch/decode.
 *
 * Outside the job/scanJob busy gates (R5c): a fetch scan may run concurrently;
 * this only reads the already-decoded playback PCM.
 *
 * Window model:
 *  - activate(fromSec): open a [WATCH_WINDOW_SEC] content window at the anchor.
 *  - PCM arrives pre-sonic at content rate; pts advances by frames/srcRate from
 *    the anchor (sample-accumulated, not wall-clock).
 *  - On window complete or a large segment gap, emit [ExtractResult.Success]
 *    via onSignal and roll forward to the next window at lastDecodedUs.
 *  - watchAnchor(sec) (after a user seek resolves): emit any usable partial,
 *    then re-base the window at the new position.
 *  - stop(): final emit if the partial clears the force threshold, then detach.
 *
 * Emissions are the raw correlation windows for Stage C — confidence gates
 * (checkpoint bars, refinement guard) live in JS, not here.
 */
class WatchCollector(
    private val context: Context,
    private val useSilero: Boolean,
    private val onSignal: (ExtractResult.Success) -> Unit,
    private val log: (String) -> Unit,
) : PlayerAudioTap.Listener {
    companion object {
        /** Content length of each rolling window. */
        private const val WATCH_WINDOW_SEC = 90.0
        /** Minimum decoded span before a non-forced emit. */
        private const val MIN_EMIT_SPAN_US = 20_000_000L
        /** Minimum decoded span for a forced emit (stop / anchor / roll). */
        private const val MIN_FORCE_SPAN_US = 15_000_000L
        /** Emit at most once per this much NEW decoded content while rolling. */
        private const val EMIT_INTERVAL_US = 45_000_000L
        /** Segment gap (wall) that forces a roll instead of a mere timeline reset. */
        private const val SEGMENT_GAP_MS = 1_000L
    }

    private val lock = Any()
    private var collector: SignalCollector? = null
    private var silero: SileroVad? = null
    private var active = false
    private var srcRate = 0
    private var channels = 0
    private var pcmEncoding = C.ENCODING_PCM_16BIT
    private var anchorUs = 0L
    private var windowToUs = 0L
    private var samplesPushed = 0L
    private var lastEmittedEndUs = -1L
    private var emits = 0
    private var droppedBuffers = 0

    /** True while a session is attached to the tap. */
    fun isActive(): Boolean = synchronized(lock) { active }

    /**
     * Open (or re-open) a session at [fromSec]. Detaches any previous session
     * first so two collectors never share the static tap listener.
     */
    fun activate(fromSec: Double, windowSec: Double = WATCH_WINDOW_SEC) {
        synchronized(lock) {
            if (active) {
                emitLocked(force = true, reason = "re-activate")
            }
            ensureVad()
            rebuildLocked(fromSec, windowSec)
            active = true
            PlayerAudioTap.listener = this
            log(
                "watch: activate at ${"%.2f".format(java.util.Locale.US, fromSec)}s " +
                    "window=${windowSec}s silero=$useSilero"
            )
        }
    }

    /**
     * Re-base after a seek (or any discontinuous position jump). Emits a
     * usable partial from the old segment first so the scan-before-seek
     * audio is not discarded.
     */
    fun anchor(toSec: Double, windowSec: Double = WATCH_WINDOW_SEC) {
        synchronized(lock) {
            if (!active) return
            emitLocked(force = true, reason = "anchor")
            rebuildLocked(toSec, windowSec)
            log("watch: anchor -> ${"%.2f".format(java.util.Locale.US, toSec)}s")
        }
    }

    /** Detach from the tap; final emit if the partial is large enough. */
    fun stop() {
        synchronized(lock) {
            if (!active) return
            emitLocked(force = true, reason = "stop")
            active = false
            PlayerAudioTap.listener = null
            collector = null
            silero?.reset()
            silero = null
            log("watch: stop emits=$emits")
        }
    }

    // ─── PlayerAudioTap.Listener (audio-sink thread) ───────────────

    override fun onFormat(sampleRate: Int, channelCount: Int, encoding: Int) {
        synchronized(lock) {
            if (!active) return
            srcRate = sampleRate
            channels = channelCount
            pcmEncoding = encoding
            collector?.onFormatChanged(sampleRate, channelCount, encoding)
        }
    }

    override fun onPcm(buffer: ByteBuffer) {
        synchronized(lock) {
            if (!active) {
                droppedBuffers++
                return
            }
            val c = collector ?: return
            if (srcRate <= 0 || channels <= 0) return

            val bytesPerFrame = channels * bytesPerSample(pcmEncoding)
            if (bytesPerFrame <= 0) return
            val frames = buffer.remaining() / bytesPerFrame
            if (frames <= 0) return

            val ptsUs = anchorUs + (samplesPushed * 1_000_000L) / srcRate
            // pushPcm may drop (pts > window end) — still advance the clock so
            // the next in-window buffer gets the correct pts after a roll.
            c.pushPcm(buffer, ptsUs)
            samplesPushed += frames

            if (c.windowComplete()) {
                emitLocked(force = true, reason = "window-complete")
                if (active) {
                    val nextFromUs = c.lastDecodedUs.coerceAtLeast(anchorUs)
                    rebuildLocked(nextFromUs / 1_000_000.0, WATCH_WINDOW_SEC)
                    log(
                        "watch: rolled window at ${"%.1f".format(java.util.Locale.US, nextFromUs / 1_000_000.0)}s " +
                            "(emits=$emits)"
                    )
                }
            } else if (c.decodedSpanUs() >= MIN_EMIT_SPAN_US) {
                maybeEmitLocked(force = false, reason = "interval")
            }
        }
    }

    override fun onFlush() {
        synchronized(lock) {
            if (!active) return
            // Seek / discontinuity: drop the partial 512-sample chunk only.
            // Full re-base is the JS anchor poll's job (Stage C).
            collector?.resetTimeline()
        }
    }

    override fun onSegmentReset(gapMs: Long) {
        synchronized(lock) {
            if (!active) return
            if (gapMs >= SEGMENT_GAP_MS) {
                log("watch: segment gap ${gapMs}ms - rolling")
                emitLocked(force = true, reason = "segment-gap")
                if (active && collector != null) {
                    val nextFromUs = collector?.lastDecodedUs ?: -1L
                    if (nextFromUs > 0) {
                        rebuildLocked(nextFromUs / 1_000_000.0, WATCH_WINDOW_SEC)
                    }
                }
            }
        }
    }

    // ─── internals (call with lock held) ────────────────────────────

    private fun ensureVad() {
        if (useSilero && silero == null) {
            silero = SileroVad(context, log = { msg -> log("watch-silero: $msg") })
        }
        silero?.reset()
    }

    private fun rebuildLocked(fromSec: Double, windowSec: Double) {
        val fromUs = (fromSec * 1_000_000).toLong()
        val toUs = ((fromSec + windowSec) * 1_000_000).toLong()
        anchorUs = fromUs
        windowToUs = toUs
        samplesPushed = 0
        lastEmittedEndUs = -1L
        val s = silero
        collector = SignalCollector(fromUs, toUs, s, log = { msg -> log("watch: $msg") })
        if (srcRate > 0) {
            collector?.onFormatChanged(srcRate, channels, pcmEncoding)
        }
    }

    private fun maybeEmitLocked(force: Boolean, reason: String) {
        val c = collector ?: return
        val span = c.decodedSpanUs()
        val min = if (force) MIN_FORCE_SPAN_US else MIN_EMIT_SPAN_US
        if (span < min) return
        if (!force && c.lastDecodedUs - lastEmittedEndUs < EMIT_INTERVAL_US) return
        emitLocked(force = true, reason = reason)
    }

    private fun emitLocked(force: Boolean, reason: String) {
        val c = collector ?: return
        val span = c.decodedSpanUs()
        val min = if (force) MIN_FORCE_SPAN_US else MIN_EMIT_SPAN_US
        if (span < min) {
            log("watch: skip emit ($reason) span=${span / 1000}ms < ${min / 1000}ms")
            return
        }
        val r = c.buildSuccess()
        if (r == null) {
            log("watch: no signal to emit ($reason) span=${span / 1000}ms")
            return
        }
        lastEmittedEndUs = c.lastDecodedUs
        emits++
        log(
            "watch: emit #$emits ($reason) [${"%.1f".format(java.util.Locale.US, r.startSec)}.." +
                "${"%.1f".format(java.util.Locale.US, r.endSec)}]s bins=${r.bins} " +
                "vad=${r.vadChose} duty=${r.sileroDuty ?: r.energyDuty}"
        )
        // Leave the lock before the callback — JS may re-enter activate/anchor.
        // (We're already inside synchronized; onSignal runs here by design — the
        // module event fan-out is non-blocking and Stage C does not re-enter
        // native synchronously from the event handler.)
        onSignal(r)
    }

    private fun bytesPerSample(encoding: Int): Int = when (encoding) {
        C.ENCODING_PCM_FLOAT -> 4
        C.ENCODING_PCM_8BIT -> 1
        C.ENCODING_PCM_24BIT -> 3
        C.ENCODING_PCM_32BIT -> 4
        else -> 2 // PCM_16BIT default
    }

    /** Diagnostics for the module / Stage C. */
    fun status(): Map<String, Any?> = synchronized(lock) {
        mapOf(
            "active" to active,
            "anchorSec" to anchorUs / 1_000_000.0,
            "windowToSec" to windowToUs / 1_000_000.0,
            "decodedSpanMs" to (collector?.decodedSpanUs() ?: 0L) / 1000L,
            "hasSignal" to (collector?.hasSignal() ?: false),
            "emits" to emits,
            "droppedBuffers" to droppedBuffers,
            "silero" to useSilero,
            "monotonicMs" to SystemClock.elapsedRealtime(),
        )
    }
}
