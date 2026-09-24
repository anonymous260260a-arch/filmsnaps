package expo.modules.subtitlesync

import android.content.Context
import android.os.SystemClock
import androidx.media3.common.C
import expo.modules.video.utils.PlayerAudioTap
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Stage B: live watch-sync collector. Sits on the playback PCM tap
 * ([PlayerAudioTap.listener]) and bins content-time speech into a rolling
 * [SignalCollector] window while the user watches — no separate fetch/decode.
 *
 * Threading contract (audio-beep fix follow-up):
 *  - Audio thread (Listener callbacks): copy buffer into the queue only.
 *    NEVER takes [stateLock], NEVER runs VAD/resample, NEVER calls onSignal.
 *  - Worker thread: owns SignalCollector/Silero, pts math, emit decisions.
 *  - Drop-oldest on overflow — a stalled worker must never backpressure AudioTrack.
 *
 * Window model:
 *  - activate(fromSec): open a [WATCH_WINDOW_SEC] content window at the anchor.
 *  - PCM arrives pre-sonic at content rate; pts advances by frames/srcRate from
 *    the anchor (sample-accumulated, not wall-clock).
 *  - On window complete or a large segment gap, emit [ExtractResult.Success]
 *    via onSignal and roll forward to the next window at lastDecodedUs.
 *  - anchor(sec) (after a user seek resolves): emit any usable partial,
 *    then re-base the window at the new position.
 *  - stop(): final emit if the partial clears the force threshold, then detach.
 */
class WatchCollector(
    private val context: Context,
    private val useSilero: Boolean,
    private val onSignal: (ExtractResult.Success) -> Unit,
    private val log: (String) -> Unit,
    /** Stage D: Silero mark-threshold hysteresis from JS (null → F6 defaults). */
    private val vadMarkOn: Float? = null,
    private val vadMarkOff: Float? = null,
) : PlayerAudioTap.Listener {
    companion object {
        private const val WATCH_WINDOW_SEC = 90.0
        private const val MIN_EMIT_SPAN_US = 20_000_000L
        private const val MIN_FORCE_SPAN_US = 15_000_000L
        private const val EMIT_INTERVAL_US = 45_000_000L
        private const val SEGMENT_GAP_MS = 1_000L
        /** ~0.6s of 40ms buffers — enough to ride short worker stalls. */
        private const val QUEUE_CAPACITY = 96
    }

    private class Chunk(val bytes: ByteArray, val bytesPerFrame: Int)

    // Audio-thread → worker handoff. Drop-oldest on overflow.
    private val queue = ArrayBlockingQueue<Chunk>(QUEUE_CAPACITY)
    @Volatile private var stopped = false
    @Volatile private var suspended = false
    @Volatile private var active = false
    @Volatile private var droppedBuffers = 0L
    @Volatile private var fmtRate = 0
    @Volatile private var fmtCh = 0
    @Volatile private var fmtEnc = C.ENCODING_PCM_16BIT

    // Worker + control-thread state (never touched on the audio thread).
    private val stateLock = Any()
    private var collector: SignalCollector? = null
    private var silero: SileroVad? = null
    private var srcRate = 0
    private var channels = 0
    private var pcmEncoding = C.ENCODING_PCM_16BIT
    private var anchorUs = 0L
    private var windowToUs = 0L
    private var samplesPushed = 0L
    private var lastEmittedEndUs = -1L
    private var emits = 0
    private var worker: Thread? = null
    /** Bumped on every start/stop so a late old worker cannot resume after restart. */
    @Volatile private var workerGen = 0
    @Volatile private var segmentResetPending = false

    fun isActive(): Boolean = active

    /**
     * Open (or re-open) a session at [fromSec]. Detaches any previous session
     * first so two collectors never share the static tap listener.
     */
    fun activate(fromSec: Double, windowSec: Double = WATCH_WINDOW_SEC) {
        synchronized(stateLock) {
            stopWorkerLocked()
            if (active) {
                emitLocked(force = true, reason = "re-activate")
            }
            ensureVad()
            rebuildLocked(fromSec, windowSec)
            active = true
            stopped = false
            suspended = false
            segmentResetPending = false
            queue.clear()
            PlayerAudioTap.listener = this
            val gen = ++workerGen
            worker = Thread({
                while (!stopped && workerGen == gen) {
                    pumpOnce()
                }
            }, "SubSyncWatch").apply {
                isDaemon = true
                start()
            }
            log(
                "watch: activate at ${"%.2f".format(java.util.Locale.US, fromSec)}s " +
                    "window=${windowSec}s silero=$useSilero"
            )
        }
    }

    /**
     * Re-base after a seek (or any discontinuous position jump). Emits a
     * usable partial from the old segment first so the pre-seek audio is
     * not discarded.
     */
    fun anchor(toSec: Double, windowSec: Double = WATCH_WINDOW_SEC) {
        if (stopped) return
        synchronized(stateLock) {
            if (!active) return
            emitLocked(force = true, reason = "anchor")
            rebuildLocked(toSec, windowSec)
            log("watch: anchor -> ${"%.2f".format(java.util.Locale.US, toSec)}s")
        }
        // Resume after the seek flush.
        suspended = false
    }

    /** Detach from the tap; final emit if the partial is large enough. */
    fun stop() {
        synchronized(stateLock) {
            if (!active && worker == null) return
            emitLocked(force = true, reason = "stop")
            active = false
            stopped = true
            PlayerAudioTap.listener = null
            collector = null
            silero?.reset()
            silero = null
            stopWorkerLocked()
            log("watch: stop emits=$emits dropped=$droppedBuffers")
        }
    }

    // ─── PlayerAudioTap.Listener — AUDIO THREAD. Copy only. ───────────

    override fun onFormat(sampleRate: Int, channelCount: Int, encoding: Int) {
        fmtRate = sampleRate
        fmtCh = channelCount
        fmtEnc = encoding
    }

    override fun onPcm(buffer: ByteBuffer) {
        if (stopped || suspended) return
        val rate = fmtRate
        val ch = fmtCh
        if (rate <= 0 || ch <= 0) return
        val bytesPerFrame = ch * bytesPerSample(fmtEnc)
        if (bytesPerFrame <= 0) return
        val rem = buffer.remaining()
        if (rem <= 0 || rem % bytesPerFrame != 0) return
        val bytes = ByteArray(rem)
        buffer.get(bytes, 0, rem)
        val chunk = Chunk(bytes, bytesPerFrame)
        if (!queue.offer(chunk)) {
            // Drop-oldest: never backpressure the AudioTrack.
            queue.poll()
            queue.offer(chunk)
            droppedBuffers++
        }
    }

    override fun onFlush() {
        suspended = true
    }

    override fun onSegmentReset(gapMs: Long) {
        if (gapMs >= SEGMENT_GAP_MS) {
            suspended = true
            segmentResetPending = true
        }
    }

    // ─── worker thread ────────────────────────────────────────────────

    private fun pumpOnce() {
        val chunk = try {
            queue.poll(200, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
            return
        } ?: return

        if (suspended) return

        synchronized(stateLock) {
            if (stopped || !active) return
            val c = collector ?: return
            val rate = fmtRate
            val ch = fmtCh
            val enc = fmtEnc
            if (rate != srcRate || ch != channels || enc != pcmEncoding) {
                c.onFormatChanged(rate, ch, enc)
                srcRate = rate
                channels = ch
                pcmEncoding = enc
            }
            if (segmentResetPending) {
                segmentResetPending = false
                c.resetTimeline()
                emitLocked(force = true, reason = "segment-gap")
                if (active && collector != null) {
                    val nextFromUs = collector?.lastDecodedUs ?: -1L
                    if (nextFromUs > 0) {
                        rebuildLocked(nextFromUs / 1_000_000.0, WATCH_WINDOW_SEC)
                    }
                }
                return
            }
            if (rate <= 0 || ch <= 0) return
            val frames = chunk.bytes.size / chunk.bytesPerFrame
            if (frames <= 0) return
            val ptsUs = anchorUs + (samplesPushed * 1_000_000L) / rate
            val bb = ByteBuffer.wrap(chunk.bytes).order(ByteOrder.LITTLE_ENDIAN)
            c.pushPcm(bb, ptsUs)
            samplesPushed += frames

            if (c.windowComplete()) {
                // W1-c: continuous audio across a window roll — carry the
                // speaking latch so a mid-utterance boundary does not drop
                // the first chunk of the next window.
                val speaking = c.isSpeaking()
                emitLocked(force = true, reason = "window-complete")
                if (active) {
                    val nextFromUs = c.lastDecodedUs.coerceAtLeast(anchorUs)
                    rebuildLocked(
                        nextFromUs / 1_000_000.0,
                        WATCH_WINDOW_SEC,
                        carrySpeaking = speaking,
                    )
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

    // ─── internals (call with stateLock held) ─────────────────────────

    private fun ensureVad() {
        if (useSilero && silero == null) {
            silero = SileroVad(context, log = { msg -> log("watch-silero: $msg") })
        }
        silero?.reset()
    }

    private fun rebuildLocked(
        fromSec: Double,
        windowSec: Double,
        carrySpeaking: Boolean = false,
    ) {
        val fromUs = (fromSec * 1_000_000).toLong()
        val toUs = ((fromSec + windowSec) * 1_000_000).toLong()
        anchorUs = fromUs
        windowToUs = toUs
        samplesPushed = 0
        lastEmittedEndUs = -1L
        val s = silero
        collector = SignalCollector(
            fromUs,
            toUs,
            s,
            log = { msg -> log("watch: $msg") },
            markOnOverride = vadMarkOn,
            markOffOverride = vadMarkOff,
            initialSpeaking = carrySpeaking,
        )
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
        onSignal(r)
    }

    private fun stopWorkerLocked() {
        // Bump gen first so a worker that is mid-pumpOnce (or waiting on
        // stateLock) exits on its next loop check — never join() while we
        // hold stateLock the worker may need (deadlock until timeout).
        workerGen++
        stopped = true
        worker = null
        queue.clear()
    }

    private fun bytesPerSample(encoding: Int): Int = when (encoding) {
        C.ENCODING_PCM_FLOAT -> 4
        C.ENCODING_PCM_8BIT -> 1
        C.ENCODING_PCM_24BIT -> 3
        C.ENCODING_PCM_32BIT -> 4
        else -> 2 // PCM_16BIT default
    }

    /** Diagnostics for the module / Stage C. */
    fun status(): Map<String, Any?> = synchronized(stateLock) {
        mapOf(
            "active" to active,
            "anchorSec" to anchorUs / 1_000_000.0,
            "windowToSec" to windowToUs / 1_000_000.0,
            "decodedSpanMs" to (collector?.decodedSpanUs() ?: 0L) / 1000L,
            "hasSignal" to (collector?.hasSignal() ?: false),
            "emits" to emits,
            "droppedBuffers" to droppedBuffers,
            "silero" to useSilero,
            "queueDepth" to queue.size,
            "monotonicMs" to SystemClock.elapsedRealtime(),
        )
    }
}
