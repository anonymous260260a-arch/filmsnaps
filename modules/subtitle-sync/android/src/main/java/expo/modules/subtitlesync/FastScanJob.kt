package expo.modules.subtitlesync

import android.net.Uri
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.mp4.FragmentedMp4Extractor
import androidx.media3.extractor.mp4.Mp4Extractor
import androidx.media3.extractor.mp3.Mp3Extractor
import androidx.media3.extractor.ts.AdtsExtractor
import androidx.media3.extractor.ts.TsExtractor
import expo.modules.video.PlayerHttp
import expo.modules.video.utils.CustomExtractorsFactory
import java.io.IOException
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Unclocked audio extraction engine.
 *
 * Replaces the headless-player scan (RemoteScanJob/HlsScanJob) which was paced
 * by the AudioTrack at up to 4x realtime and anchored the signal with
 * wall-clock estimates. This engine demuxes + decodes directly:
 *
 *  - progressive: OkHttpDataSource (same client/headers as playback) ->
 *    CustomExtractorsFactory sniff (incl. SecondarySeekHeadMatroskaExtractor
 *    for no-seek MKVs) -> SeekMap-based seek to the window -> extractor read
 *    loop -> MediaCodec -> PTS-anchored bins. Runs as fast as network+CPU
 *    allow (typically 5-30x realtime).
 *  - HLS: playlist parsed directly (audio-only rendition preferred), segments
 *    fetched/decrypted, per-segment extractor (TS / fMP4 / ADTS / MP3), same
 *    decode pipeline. No AudioTrack, no tap, no player quirks.
 *
 * Diagnostics: every milestone goes to logcat (`SubSyncFast`), the JS
 * `onDebug` event, a pollable [status], AND is attached to the final result
 * (see [debugTrace]) so the trace reaches the JS console even if event
 * delivery is broken.
 */
@UnstableApi
class FastScanJob(
    private val context: android.content.Context,
    private val uri: String,
    private val headers: Map<String, String>,
    private val fromSec: Double,
    private val toSec: Double,
    private val useSilero: Boolean,
    private val container: String, // "hls" | "progressive"
    private val preferredLang: String?,
    /** R5-3: Silero diagnostics (tensor metadata + the first 200 probabilities). */
    private val vadDebug: Boolean = false,
    /** G1: measured link speed (Mbps). Reads capped at 0.35 × this. 0 = uncapped. */
    private val throttleMbps: Double = 0.0,
    /** G3: cellular + projected >20MB → confirm-bybytes unless allowConfirmBytes. */
    private val cellular: Boolean = false,
    private val allowConfirmBytes: Boolean = false,
    private val onProgress: (Float) -> Unit,
    private val onDebug: (String) -> Unit,
    private val onResult: (ExtractResult) -> Unit,
) : ScanJob {
    companion object {
        private const val TAG = "SubSyncFast"
        /** G2: set by SubtitleSyncModule.setPlayerStruggling — pause reads while true. */
        @Volatile var playerStruggling: Boolean = false
        /** No-seek sources: max sequential preroll we decode to reach a window. */
        private const val PREROLL_MAX_US = 180_000_000L
        /** Hard wall-clock budget per window. */
        private const val BUDGET_MS = 150_000L
        /** No extractor/decoder progress for this long -> stall. */
        private const val STALL_MS = 30_000L
        /** Minimum decoded span for a budget-exhausted window to count as partial success. */
        private const val PARTIAL_MIN_US = 20_000_000L
        /** HLS segments before/after the window for extractor continuity. */
        private const val SEGMENT_MARGIN_US = 2_000_000L
        private const val TRACE_MAX_CHARS = 4000
        /** R5-5: how many trace lines the poller can still read back. */
        private const val TRACE_MAX_LINES = 400
        /** G3: cellular windows projecting above this many MB need user confirm. */
        private const val CONFIRM_BYTES_MB = 20.0
        /** G1: target read rate = THROTTLE_FRACTION × measured link speed. */
        private const val THROTTLE_FRACTION = 0.35
        private const val THROTTLE_WINDOW_MS = 1000L
        private const val THROTTLE_SLEEP_MS = 250L
        /** Fallback HLS segment size when the playlist has no BYTERANGE (session: 1.5–4MB). */
        private const val HLS_SEG_EST_BYTES = 2L * 1024 * 1024
        /**
         * B5: projected-download ceiling per window. With the content length and
         * durationUs from the SeekMap we know the average bytes/sec, so a window
         * whose projected traffic exceeds this budget is SHRUNK before decoding.
         * The 4K MKV averaged ~15.4 Mbps: a 240s window projects ~450-600MB
         * through an ~8 Mbps link, which stalls playback and burns data.
         */
        private const val WINDOW_BYTE_BUDGET_MB = 80.0

        /** Segments the HLS prefetch consumer may be ahead of decode (ring ≈ 4 slots). */
        private const val LOOK_AHEAD = 2
        private const val HLS_PREFETCH_WORKERS = 2
    }

    /**
     * G1: byte-budget throttle over a 1s window. Sleeps the caller in 250ms
     * steps when the window is over 0.35 × measured speed; logs once per window.
     */
    private inner class ReadThrottle {
        private val budgetBytesPerSec =
            if (throttleMbps > 0) throttleMbps * THROTTLE_FRACTION * 1_000_000.0 / 8.0 else 0.0
        private var windowStart = SystemClock.elapsedRealtime()
        private var windowBytes = 0L

        fun onBytes(n: Long) {
            if (budgetBytesPerSec <= 0) return
            windowBytes += n
            val now = SystemClock.elapsedRealtime()
            val elapsed = now - windowStart
            if (elapsed >= THROTTLE_WINDOW_MS) {
                val avgMbps = windowBytes * 8.0 / (elapsed / 1000.0) / 1_000_000.0
                val budgetMbps = budgetBytesPerSec * 8.0 / 1_000_000.0
                d(
                    "throttle: budget=${"%.2f".format(java.util.Locale.US, budgetMbps)} Mbps, " +
                        "avg read rate=${"%.2f".format(java.util.Locale.US, avgMbps)} Mbps"
                )
                windowStart = now
                windowBytes = 0
                return
            }
            val allowed = budgetBytesPerSec * (elapsed / 1000.0)
            if (windowBytes > allowed) {
                val overMs = ((windowBytes - allowed) / budgetBytesPerSec * 1000.0).toLong()
                val sleep = ((overMs + THROTTLE_SLEEP_MS - 1) / THROTTLE_SLEEP_MS) * THROTTLE_SLEEP_MS
                var remaining = sleep
                while (remaining > 0 && !cancelled.get()) {
                    val step = minOf(remaining, THROTTLE_SLEEP_MS)
                    Thread.sleep(step)
                    remaining -= step
                }
            }
        }
    }

    private val readThrottle = ReadThrottle()

    /** G2: block while the player rebuffers, feeding the stall watchdog. */
    private fun awaitPlayerRecovered(tick: () -> Unit) {
        while (playerStruggling && !cancelled.get()) {
            tick()
            try {
                Thread.sleep(100)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return
            }
        }
    }

    /**
     * G3: cellular + projected bytes over the confirm threshold → early error
     * so the UI can dialog before burning the download.
     */
    private fun confirmGate(projectedMb: Double): ExtractResult.Error? {
        if (!cellular || allowConfirmBytes || projectedMb <= CONFIRM_BYTES_MB) return null
        d("confirm-bybytes: projected=${projectedMb.toInt()}MB on cellular (>${CONFIRM_BYTES_MB.toInt()}MB)")
        return ExtractResult.Error("confirm-bybytes", "projectedMb=${projectedMb.toInt()}")
    }

    private val cancelled = AtomicBoolean(false)
    private var currentDataSource: DataSource? = null
    /** Content length as reported by the data source (input to the B5 clamp). */
    private var sourceLength = -1L

    // --- polling status + trace (event-delivery-independent) ---
    @Volatile private var phase: String = "starting"
    @Volatile private var progressHint: Float = 0f
    private val trace = StringBuilder()
    // R5-5: monotonic line counter + bounded tail, so the JS poller prints by
    // INDEX. Text-length slicing desynced whenever the ring trimmed (the
    // malformed "0 size=8192" line) and silently dropped lines when more than a
    // ring's worth arrived between two 500ms polls.
    private val traceLines = ArrayDeque<String>()
    @Volatile private var traceLineCount: Long = 0L
    private val traceLock = Any()

    private fun d(msg: String) {
        Log.i(TAG, msg)
        val line = "${SystemClock.elapsedRealtime() / 1000}s $msg"
        synchronized(traceLock) {
            trace.append(line).append('\n')
            traceLines.addLast(line)
            while (traceLines.size > TRACE_MAX_LINES) traceLines.removeFirst()
            traceLineCount++
            if (trace.length > TRACE_MAX_CHARS) {
                // B4: trim on a LINE boundary. Cutting mid-line left a headless
                // fragment at the front of the rolling trace, which the JS
                // poller then printed as a broken line ("0 size=8192" was the
                // tail of "dec: first decoded PCM: pts=0 size=8192").
                val cut = trace.length - TRACE_MAX_CHARS
                val nl = trace.indexOf("\n", cut)
                trace.delete(0, if (nl >= 0) nl + 1 else trace.length)
            }
        }
        onDebug(msg)
    }

    fun debugTrace(): String = synchronized(traceLock) { trace.toString() }

    /** Pollable status for the JS progress UI. */
    fun status(): Map<String, Any?> = mapOf(
        "phase" to phase,
        "progress" to progressHint,
        "trace" to debugTrace(),
        "lineCount" to traceLineCount,
        "traceLines" to synchronized(traceLock) { traceLines.toList() },
    )

    override fun cancel() {
        cancelled.set(true)
        try { currentDataSource?.close() } catch (_: Exception) {}
    }

    fun start() {
        Thread {
            val t0 = SystemClock.elapsedRealtime()
            val r = try {
                if (container == "hls") scanHls(t0) else scanProgressive(t0)
            } catch (t: Throwable) {
                if (cancelled.get()) {
                    ExtractResult.Error("cancelled", "cancelled")
                } else {
                    Log.e(TAG, "scan failed", t)
                    d("FATAL ${t.javaClass.simpleName}: ${t.message}")
                    ExtractResult.Error("decode-failed", "${t.javaClass.simpleName}: ${t.message}")
                }
            }
            d(
                when (r) {
                    is ExtractResult.Success ->
                        "DONE in ${SystemClock.elapsedRealtime() - t0}ms: ${r.bins} bins [${r.startSec}..${r.endSec}]s"
                    is ExtractResult.Error ->
                        "FAILED in ${SystemClock.elapsedRealtime() - t0}ms: ${r.code} - ${r.message}"
                }
            )
            // Always settle the JS promise — even on cancel. Suppressing
            // onResult left scanAsync hanging, so extractWithRetry's poller
            // never stopped and a restart printed interleaved trace lines.
            onResult(r)
        }.also { it.isDaemon = false }.start()
    }

    // ------------------------------------------------------------------
    // Progressive path
    // ------------------------------------------------------------------

    private fun dataSourceFactory(): OkHttpDataSource.Factory =
        OkHttpDataSource.Factory(PlayerHttp.client).apply {
            if (headers.isNotEmpty()) setDefaultRequestProperties(headers)
            setUserAgent(headers["User-Agent"] ?: "filmsnaps")
        }

    /**
     * G1: wrap the progressive DataSource so every network read is billed
     * against the 0.35×-of-measured budget (sleeps inside read when over).
     */
    private fun throttledDs(): DataSource {
        val inner = dataSourceFactory().createDataSource()
        if (throttleMbps <= 0) return inner
        return object : DataSource {
            override fun addTransferListener(transferListener: androidx.media3.datasource.TransferListener) {
                inner.addTransferListener(transferListener)
            }
            override fun open(dataSpec: DataSpec): Long = inner.open(dataSpec)
            override fun read(target: ByteArray, offset: Int, length: Int): Int {
                // G2: hold the read while the player is rebuffers.
                awaitPlayerRecovered { }
                val n = inner.read(target, offset, length)
                if (n > 0) readThrottle.onBytes(n.toLong())
                return n
            }
            override fun getUri(): Uri? = inner.uri
            override fun getResponseHeaders(): Map<String, List<String>> = inner.responseHeaders
            override fun close() { inner.close() }
        }
    }

    private fun openAt(ds: DataSource, position: Long): ExtractorInput {
        val spec = DataSpec.Builder()
            .setUri(Uri.parse(uri))
            .setPosition(position)
            .setLength(C.LENGTH_UNSET.toLong())
            .build()
        currentDataSource = ds
        val len = ds.open(spec)
        if (len > 0) sourceLength = len
        d("open @byte=$position len=$len")
        return DefaultExtractorInput(ds, position, len)
    }

    private fun scanProgressive(t0: Long): ExtractResult {
        val fromUs = (fromSec * 1_000_000).toLong()
        // B5: mutable - the bitrate-aware clamp below may shrink the window end.
        var toUs = (toSec * 1_000_000).toLong()
        // R8-1: Silero + Energy both run from chunk 1 (collector owns the Energy
        // instance); the winner is chosen at end-of-window, never mid-scan.
        val silero = if (useSilero) {
            SileroVad(context, debug = vadDebug, log = { msg -> d(msg) })
        } else {
            null
        }
        val collector = SignalCollector(fromUs, toUs, silero, log = { msg -> d(msg) })
        val decoder = AudioDecoder(collector) { d("dec: $it") }
        val tap = AudioTapOutput(decoder)
        val output = TapExtractorOutput(
            decoder,
            tap,
            preferredLang = preferredLang,
            onTrace = { d(it) },
        )
        val holder = PositionHolder()
        var lastProgressWall = SystemClock.elapsedRealtime()
        var lastPos = 0L
        var lastSeekUs = 0L
        var silentTrackRetries = 0
        var langUpgradeTried = false

        val ds = throttledDs()
        var input: ExtractorInput
        var position = 0L
        try {
            phase = "connecting"
            input = openAt(ds, 0L)

            // Sniff battery (custom Matroska first, then all stock extractors).
            phase = "sniffing"
            val extractors = CustomExtractorsFactory().createExtractors()
            var chosen: Extractor? = null
            for (e in extractors) {
                if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
                try {
                    input.resetPeekPosition()
                    if (e.sniff(input)) {
                        chosen = e
                        break
                    }
                } catch (e: IOException) {
                    d("sniff ${e.javaClass.simpleName} threw: ${e.message}")
                }
            }
            if (chosen == null) {
                return ExtractResult.Error("unsupported-format", "no extractor matched container")
            }
            d("progressive: extractor=${chosen.javaClass.simpleName} silero=$useSilero")
            chosen.init(output)
            tap.beginSegment(0L, pinFirst = false) // container PTS are content time

            retry@ while (true) {
            var seekApplied = false
            var eof = false
            var reads = 0L
            var passes = 1
            while (!eof && !cancelled.get()) {
                if (SystemClock.elapsedRealtime() - t0 > BUDGET_MS) {
                    d("budget exhausted at inputPos=$lastPos")
                    break
                }
                // G2: player rebuffering — hold network reads, keep stall clock fed.
                awaitPlayerRecovered { lastProgressWall = SystemClock.elapsedRealtime() }
                if (SystemClock.elapsedRealtime() - lastProgressWall > STALL_MS) {
                    d("STALL: no progress 30s at inputPos=$lastPos")
                    return ExtractResult.Error("timeout", "no extraction progress for ${STALL_MS / 1000}s")
                }

                // Apply the time seek once the SeekMap is known.
                if (!seekApplied && output.seekMap != null) {
                    seekApplied = true
                    val sm = output.seekMap!!
                    d("seekMap: seekable=${sm.isSeekable} durationUs=${sm.durationUs}")
                    // B5: bitrate-aware window clamp. Never extends, only shrinks.
                    if (sourceLength > 0 && sm.durationUs > 0 && toUs - fromUs > 0) {
                        val bytesPerSec =
                            sourceLength.toDouble() / (sm.durationUs / 1_000_000.0)
                        val projectedMb =
                            (toUs - fromUs) / 1_000_000.0 * bytesPerSec / 1024.0 / 1024.0
                        // G3: dialog gate BEFORE any window decode on cellular.
                        confirmGate(projectedMb)?.let { return it }
                        val maxSpanUs =
                            (WINDOW_BYTE_BUDGET_MB * 1024.0 * 1024.0 / bytesPerSec * 1_000_000.0).toLong()
                        if (toUs - fromUs > maxSpanUs && maxSpanUs > 0) {
                            toUs = fromUs + maxSpanUs
                            // No PCM has been pushed yet (the seek happens next),
                            // so rebasing the collector here is free.
                            collector.resetAll(fromUs, toUs)
                            d(
                                "window clamp: len=$sourceLength dur=${sm.durationUs / 1_000_000}s " +
                                    "projected=${projectedMb.toInt()}MB -> clamped to ${maxSpanUs / 1_000_000}s " +
                                    "(budget ${WINDOW_BYTE_BUDGET_MB.toInt()}MB)"
                            )
                        }
                    }
                    if (fromUs > 2_000_000L) {
                        if (sm.isSeekable) {
                            val sp = sm.getSeekPoints(fromUs).first
                            position = sp.position
                            lastSeekUs = sp.timeUs
                            input = reopen(ds, position)
                            chosen.seek(position, sp.timeUs)
                            tap.reset()
                            collector.resetTimeline()
                            d("seek -> ${sp.timeUs / 1000}ms @ byte $position")
                            phase = "decoding"
                        } else if (fromUs > PREROLL_MAX_US) {
                            return ExtractResult.Error(
                                "unseekable",
                                "no seek index; window starts ${(fromUs / 1_000_000).toInt()}s into an unseekable stream",
                            )
                        } else {
                            d("unseekable stream - decoding sequentially from 0 (preroll ${fromUs / 1_000_000}s <= ${PREROLL_MAX_US / 1_000_000}s)")
                            phase = "decoding"
                        }
                    } else {
                        phase = "decoding"
                    }
                }

                val result = chosen.read(input, holder)
                reads++
                when (result) {
                    Extractor.RESULT_SEEK -> {
                        position = holder.position
                        d("extractor seek -> byte $position (read #$reads)")
                        input = reopen(ds, position)
                    }
                    Extractor.RESULT_END_OF_INPUT -> {
                        d("EOF at inputPos=$lastPos after $reads reads (pass $passes, seekApplied=$seekApplied, seekMap=${output.seekMap != null})")
                        eof = true
                    }
                }

                if (input.position != lastPos) {
                    lastPos = input.position
                    lastProgressWall = SystemClock.elapsedRealtime()
                }
                if (decoder.drain(8)) break
                if (decoder.error != null) return decoder.error!!
                if (collector.windowComplete()) break
                // Early silence bail: if we have decoded a real span that is pure
                // digital silence (broken/silent mux track), stop wasting time and
                // let the no-signal handler retry the next audio-track candidate.
                if (collector.decodedSpanUs() > 20_000_000L &&
                    collector.totalChunks > 400 && collector.rmsPeak < 0.005f &&
                    tap.samplesTapped > 0
                ) {
                    d("early silence bail: span=${collector.decodedSpanUs() / 1000}ms peak=${collector.rmsPeak} - breaking to retry track")
                    break
                }

                val p = collector.progress(fromUs)
                if (p > progressHint) progressHint = p
                onProgress(p)
                if (p > 0f) lastProgressWall = SystemClock.elapsedRealtime()
            }

            // EOF recovery: if the extractor hit EOF before the time-seek could
            // be applied (tail-Cues containers: header -> Cues at EOF), do one
            // more pass starting at the seek point instead of failing.
            if (eof && (!seekApplied || !collector.hasSignal()) &&
                output.seekMap != null && output.seekMap!!.isSeekable &&
                passes == 1 && !cancelled.get()
            ) {
                passes = 2
                eof = false
                val sp = output.seekMap!!.getSeekPoints(fromUs).first
                position = sp.position
                input = reopen(ds, position)
                chosen.seek(position, sp.timeUs)
                tap.reset()
                collector.resetTimeline()
                d("EOF recovery pass 2: seek -> ${sp.timeUs / 1000}ms @ byte $position")
                while (!eof && !cancelled.get()) {
                    if (SystemClock.elapsedRealtime() - t0 > BUDGET_MS) {
                        d("budget exhausted (pass 2) at inputPos=$lastPos")
                        break
                    }
                    if (SystemClock.elapsedRealtime() - lastProgressWall > STALL_MS) {
                        return ExtractResult.Error("timeout", "no extraction progress for ${STALL_MS / 1000}s")
                    }
                    when (chosen.read(input, holder)) {
                        Extractor.RESULT_SEEK -> {
                            position = holder.position
                            input = reopen(ds, position)
                        }
                        Extractor.RESULT_END_OF_INPUT -> eof = true
                    }
                    if (input.position != lastPos) {
                        lastPos = input.position
                        lastProgressWall = SystemClock.elapsedRealtime()
                    }
                    if (decoder.drain(8)) break
                    if (decoder.error != null) return decoder.error!!
                    if (collector.windowComplete()) break
                    // Late language upgrade: some muxers announce the
                    // language-matched audio track only after the first blocks,
                    // so re-check once, early, instead of committing to the
                    // wrong track (a Hindi dub against an English subtitle
                    // correlates terribly).
                    if (!langUpgradeTried) {
                        val want = output.preferredCandidate()
                        if (want != null && want != output.currentClaimId && tap.samplesTapped < 400) {
                            langUpgradeTried = true
                            val f = output.formatOf(want)
                            d(
                                "late language match (pref=${preferredLang ?: "-"}) - switching to " +
                                    "audio track id=$want (lang=${f?.language ?: "-"} ${f?.sampleMimeType})"
                            )
                            decoder.releaseCodec()
                            collector.resetAll(fromUs, toUs)
                            tap.reset()
                            output.claim(want)
                            seekApplied = false
                            eof = false
                            continue@retry
                        }
                    }
                    val p = collector.progress(fromUs)
                    if (p > progressHint) progressHint = p
                    onProgress(p)
                    if (p > 0f) lastProgressWall = SystemClock.elapsedRealtime()
                }
            }

            if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
            if (decoder.error != null) return decoder.error!!
            if (!collector.hasSignal()) {
                d(
                    "no signal: seekApplied=$seekApplied eof=$eof reads=$reads inputPos=$lastPos " +
                        "formatSeen=${decoder.formatSeen != null} tracks=${output.trackSummary()} tap: samples=${tap.samplesTapped} " +
                        "pts=[${tap.firstTappedPtsUs}..${tap.lastTappedPtsUs}] ${decoder.diagnostics()}"
                )
                val candidates = output.audioCandidates()
                if (tap.samplesTapped > 0 && collector.totalChunks > 500 && collector.rmsPeak < 0.005f &&
                    candidates.size > silentTrackRetries + 1
                ) {
                    // Decoded a real span of pure digital silence: the tapped audio
                    // track is a silent filler (common in multi-audio MKVs).
                    // Retry the window with the next audio-track candidate.
                    silentTrackRetries++
                    val nextId = candidates[silentTrackRetries]
                    val nextFmt = output.formatOf(nextId)
                    d(
                        "silent track detected - retrying window with audio track id=$nextId " +
                            "(${nextFmt?.sampleMimeType} lang=${nextFmt?.language}) " +
                            "[candidates: ${candidates.joinToString()}]"
                    )
                    decoder.releaseCodec()
                    collector.resetAll(fromUs, toUs)
                    tap.reset()
                    output.claim(nextId)
                    // restart the read loop from the seek point
                    seekApplied = false
                    eof = false
                    continue@retry
                }
                if (tap.samplesTapped > 0 && collector.rmsPeak < 0.005f) {
                    return ExtractResult.Error(
                        "silent-audio-track",
                        "tapped audio track is silent (${tap.samplesTapped} samples, ${output.trackSummary()})",
                    )
                }
                return ExtractResult.Error("no-audio-track", "no audio decoded in window")
            }
            decoder.finish()
            d("decoded track: ${output.claimedSummary()}")
            return partialOrSuccess(collector, t0)
            } // retry@
        } catch (e: IOException) {
            if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
            if (decoder.error != null) return decoder.error!!
            d("IOException: ${e.message}")
            return classifyIo(e)
        } finally {
            try { ds.close() } catch (_: Exception) {}
            decoder.releaseCodec()
        }
    }

    private fun reopen(ds: DataSource, position: Long): ExtractorInput {
        try { ds.close() } catch (_: Exception) {}
        return openAt(ds, position)
    }

    // ------------------------------------------------------------------
    // HLS path
    // ------------------------------------------------------------------

    private fun scanHls(t0: Long): ExtractResult {
        val fromUs = (fromSec * 1_000_000).toLong()
        val toUs = (toSec * 1_000_000).toLong()
        // R8-1: dual-VAD collector (see scanProgressive) — winner chosen at end.
        val silero = if (useSilero) {
            SileroVad(context, debug = vadDebug, log = { msg -> d(msg) })
        } else {
            null
        }
        val collector = SignalCollector(fromUs, toUs, silero, log = { msg -> d(msg) })
        val decoder = AudioDecoder(collector) { d("dec: $it") }
        // ConcurrentHashMap: fetch workers share the AES key cache with the
        // playlist/key path on the scan thread.
        val keyCache = ConcurrentHashMap<String, ByteArray>()

        try {
            phase = "playlist"
            d("hls: resolving playlist $uri")
            val mediaUrl = HlsPlaylistParser.resolveToMedia(uri, headers)
            val pl = HlsPlaylistParser.parse(mediaUrl, headers)
            d(
                "hls parsed: ${pl.segments.size} segs live=${pl.live} total=${(pl.totalDurationUs / 1_000_000).toInt()}s " +
                    "init=${if (pl.initUrl != null) "yes" else "no"} key=${pl.keyMethod ?: "none"} " +
                    "segDur=${pl.segments.firstOrNull()?.durationUs?.div(1000)}ms"
            )
            if (pl.live) return ExtractResult.Error("live-unsupported", "live stream")
            if (pl.keyMethod != null && pl.keyMethod != "AES-128" && pl.keyMethod != "NONE") {
                return ExtractResult.Error("drm-unsupported", "HLS key method ${pl.keyMethod}")
            }

            // Window -> segment slice.
            var declared = 0L
            var firstIdx = -1
            var lastIdx = pl.segments.size - 1
            for (i in pl.segments.indices) {
                val seg = pl.segments[i]
                val segEnd = declared + seg.durationUs
                if (firstIdx < 0 && segEnd > fromUs - SEGMENT_MARGIN_US) firstIdx = i
                if (declared > toUs + SEGMENT_MARGIN_US) {
                    lastIdx = i - 1
                    break
                }
                declared += seg.durationUs
            }
            if (firstIdx < 0) {
                return ExtractResult.Error("unsupported-format", "window beyond playlist end")
            }
            d("hls window: segs $firstIdx..$lastIdx of ${pl.segments.size}")

            // G3: estimate window bytes (BYTERANGE when present, else session median ~2MB/seg).
            if (cellular && !allowConfirmBytes) {
                var projectedBytes = 0L
                for (i in firstIdx..lastIdx) {
                    val bl = pl.segments[i].byteLength
                    projectedBytes += if (bl > 0) bl else HLS_SEG_EST_BYTES
                }
                confirmGate(projectedBytes / (1024.0 * 1024.0))?.let { return it }
            }

            val initBytes = pl.initUrl?.let {
                d("fetching init segment")
                HlsPlaylistParser.fetchSegment(
                    HlsSegment(it, 0, pl.initByteOffset, pl.initByteLength, 0, "NONE", null, null, 0),
                    headers, keyCache,
                ) { n -> readThrottle.onBytes(n) }
            }

            var segStart = 0L
            for (i in 0 until firstIdx) segStart += pl.segments[i].durationUs

            var lastClaim = "-"
            var decodeTotalMs = 0L
            var segsDecoded = 0
            val prefetch = HlsSegmentPrefetch(firstIdx, lastIdx, pl.segments, headers, keyCache, cancelled) { msg ->
                d(msg)
            }
            val loopT0 = SystemClock.elapsedRealtime()
            try {
                for (i in firstIdx..lastIdx) {
                    if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
                    if (SystemClock.elapsedRealtime() - t0 > BUDGET_MS) {
                        d("budget exhausted at seg $i")
                        break
                    }
                    // G2: hold segment fetch while the player rebuffers.
                    awaitPlayerRecovered { }

                    phase = "fetching seg $i"
                    val seg = pl.segments[i]
                    val raw = try {
                        prefetch.await(i)
                    } catch (e: PlaylistProbe.PlaylistError) {
                        if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
                        return ExtractResult.Error(e.code, e.message ?: "segment fetch failed")
                    }
                    val segFetchMs = prefetch.takeFetchMs(i)
                    d("seg[$i] ${seg.url.substringAfterLast('/')} ${raw.size}B in ${segFetchMs}ms @${segStart / 1000}ms")
                    val data = if (initBytes != null) initBytes + raw else raw

                    phase = "decoding seg $i"
                    val decodeT0 = SystemClock.elapsedRealtime()
                    val tap = AudioTapOutput(decoder)
                    tap.reset()
                    tap.beginSegment(segStart, pinFirst = true)
                    collector.resetTimeline()
                    val output = TapExtractorOutput(
                        decoder,
                        tap,
                        preferredLang = preferredLang,
                        onTrace = { d(it) },
                    )

                    // fMP4 with an init map: the concatenated [init+segment] stream is
                    // always FragmentedMp4. Otherwise sniff the segment itself with a
                    // FRESH extractor battery (extractors are stateful - never reuse
                    // one across segments after END_OF_INPUT).
                    val extractor: Extractor = if (initBytes != null) {
                        FragmentedMp4Extractor()
                    } else {
                        val sniffDs = ByteArrayDataSource2(data).apply { open(DataSpec.Builder().setUri(Uri.EMPTY).build()) }
                        val sniffInput = DefaultExtractorInput(sniffDs, 0, data.size.toLong())
                        var found: Extractor? = null
                        for (e in freshBattery()) {
                            try {
                                sniffInput.resetPeekPosition()
                                if (e.sniff(sniffInput)) {
                                    found = e
                                    break
                                }
                            } catch (_: IOException) {}
                        }
                        found ?: run {
                            d("seg[$i]: NO extractor matched (first bytes: ${data.take(8).joinToString(" ") { "%02x".format(it) }})")
                            return ExtractResult.Error(
                                "unsupported-format",
                                "no extractor matched HLS segment ${seg.url}",
                            )
                        }
                    }
                    extractor.init(output)
                    if (i == firstIdx) d("seg[$i] extractor=${extractor.javaClass.simpleName}")

                    // Length UNSET (not data.size): with a known length TsExtractor's
                    // duration reader binary-searches the truncated stream for PCR
                    // timestamps and seek-loops forever. Unknown length -> it skips
                    // duration detection and starts parsing packets immediately.
                    var segInput: ExtractorInput = DefaultExtractorInput(
                        ByteArrayDataSource2(data).apply { open(DataSpec.Builder().setUri(Uri.EMPTY).build()) },
                        0, C.LENGTH_UNSET.toLong(),
                    )
                    val holder = PositionHolder()
                    var eof = false
                    var segReads = 0L
                    var segSeeks = 0L
                    while (!eof && !cancelled.get()) {
                        segReads++
                        if (segReads > 200_000) {
                            d("seg[$i]: read-loop cap hit ($segReads reads, $segSeeks seeks) - continuing with what we have")
                            break
                        }
                        when (extractor.read(segInput, holder)) {
                            Extractor.RESULT_SEEK -> {
                                segSeeks++
                                if (segSeeks > 50) {
                                    d("seg[$i]: seek loop detected ($segSeeks seeks to byte ${holder.position}) - continuing with what we have")
                                    break
                                }
                                // Extractors don't seek within a fully-buffered segment;
                                // restart at the requested byte offset.
                                val ds2 = ByteArrayDataSource2(data).apply { open(DataSpec.Builder().setUri(Uri.EMPTY).build()) }
                                segInput = DefaultExtractorInput(ds2, holder.position, C.LENGTH_UNSET.toLong())
                            }
                            Extractor.RESULT_END_OF_INPUT -> eof = true
                        }
                        if (decoder.drain(8)) break
                        if (decoder.error != null) return decoder.error!!
                    }
                    decodeTotalMs += SystemClock.elapsedRealtime() - decodeT0
                    segsDecoded++
                    if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
                    if (decoder.error != null) return decoder.error!!
                    if (i == firstIdx) {
                        d(
                            "seg[$i] decoded: tap=${tap.samplesTapped} tracks=${output.trackSummary()} " +
                                "dec=${decoder.diagnostics()} span=${collector.decodedSpanUs() / 1000}ms"
                        )
                    }
                    lastClaim = output.claimedSummary()
                    if (collector.windowComplete()) break

                    segStart += seg.durationUs
                    val p = ((segStart - fromUs).toFloat() / (toUs - fromUs).toFloat()).coerceIn(0.01f, 1f)
                    if (p > progressHint) progressHint = p
                    onProgress(p)
                }
            } finally {
                val wallMs = SystemClock.elapsedRealtime() - loopT0
                prefetch.logStats(wallMs, decodeTotalMs, segsDecoded)
                prefetch.shutdown()
            }

            if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
            if (decoder.error != null) return decoder.error!!
            if (!collector.hasSignal()) {
                d("hls no signal: ${decoder.diagnostics()}")
                return ExtractResult.Error("no-audio-track", "no audio decoded in window")
            }
            decoder.finish()
            d("decoded track: $lastClaim")
            return partialOrSuccess(collector, t0)
        } catch (e: PlaylistProbe.PlaylistError) {
            if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
            d("playlist error: ${e.code} ${e.message}")
            return ExtractResult.Error(e.code, e.message ?: "playlist error")
        } catch (e: IOException) {
            if (cancelled.get()) return ExtractResult.Error("cancelled", "cancelled")
            if (decoder.error != null) return decoder.error!!
            d("IOException: ${e.message}")
            return classifyIo(e)
        } finally {
            decoder.releaseCodec()
        }
    }

    // ------------------------------------------------------------------

    /**
     * Bounded HLS segment prefetch: two worker threads fetch/decrypt up to
     * [LOOK_AHEAD] segments ahead while the scan thread decodes in index order.
     * AES-128 decrypt runs inside fetchSegment (worker returns plaintext).
     *
     * Failure: a failed fetch is surfaced to await() with the same
     * PlaylistError codes as the sequential path — never dropped silently.
     * A "network" failure under parallel fetch is retried once on the consumer
     * thread after flipping to sequential (some CDNs cap concurrent connections).
     */
    private inner class HlsSegmentPrefetch(
        private val firstIdx: Int,
        private val lastIdx: Int,
        private val segments: List<HlsSegment>,
        private val headers: Map<String, String>,
        private val keyCache: MutableMap<String, ByteArray>,
        private val cancelled: AtomicBoolean,
        private val log: (String) -> Unit,
    ) {
        private val pending = ConcurrentHashMap<Int, Future<ByteArray>>()
        private val fetchMsBySeg = ConcurrentHashMap<Int, Long>()
        private val executor = Executors.newFixedThreadPool(HLS_PREFETCH_WORKERS) { r ->
            Thread(r, "hls-prefetch").also { it.isDaemon = true }
        }
        private val lock = Any()
        private var nextToSubmit = firstIdx
        @Volatile private var sequential = false
        private var fetchCount = 0
        private var fetchTotalMs = 0L

        private fun fetchOne(idx: Int): ByteArray {
            // G2 + G1: recover from player stall, then bill bytes against the throttle.
            awaitPlayerRecovered { }
            return HlsPlaylistParser.fetchSegment(segments[idx], headers, keyCache) { n ->
                readThrottle.onBytes(n)
            }
        }

        fun await(i: Int): ByteArray {
            if (sequential) return fetchSequential(i)
            submitAhead(i)
            val fut = pending.remove(i) ?: return fetchSequential(i)
            try {
                return fut.get()
            } catch (e: ExecutionException) {
                val cause = e.cause
                if (cause is PlaylistProbe.PlaylistError) {
                    if (cause.code == "network") {
                        log("hls prefetch: connection-cap with 2 in-flight - falling back to sequential")
                        sequential = true
                        cancelRemaining()
                        return fetchSequential(i)
                    }
                    throw cause
                }
                if (cancelled.get()) {
                    throw PlaylistProbe.PlaylistError("cancelled", "cancelled")
                }
                throw PlaylistProbe.PlaylistError(
                    "network",
                    cause?.message ?: "segment prefetch failed",
                )
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                throw PlaylistProbe.PlaylistError("cancelled", "cancelled")
            }
        }

        fun takeFetchMs(i: Int): Long = fetchMsBySeg.remove(i) ?: -1L

        fun logStats(wallMs: Long, decodeTotalMs: Long, segs: Int) {
            if (segs <= 0) return
            val fetchAvg = fetchTotalMs / segs
            val decodeAvg = decodeTotalMs / segs
            val overlapSaved = (fetchTotalMs + decodeTotalMs) - wallMs
            log(
                "hls prefetch: $segs segs, wall=${wallMs}ms fetch-sum=${fetchTotalMs}ms " +
                    "(avg ${fetchAvg}ms), decode-sum=${decodeTotalMs}ms " +
                    "(avg ${decodeAvg}ms), overlap saved ~${overlapSaved}ms" +
                    if (sequential) " (sequential fallback)" else ""
            )
        }

        fun shutdown() {
            cancelRemaining()
            executor.shutdownNow()
            try {
                executor.awaitTermination(2, TimeUnit.SECONDS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }

        private fun cancelRemaining() {
            for ((_, fut) in pending) {
                fut.cancel(true)
            }
            pending.clear()
        }

        private fun submitAhead(consumerIdx: Int) {
            synchronized(lock) {
                val limit = minOf(consumerIdx + LOOK_AHEAD, lastIdx)
                while (nextToSubmit <= limit) {
                    val idx = nextToSubmit++
                    if (cancelled.get()) return
                    pending[idx] = executor.submit(Callable {
                        val t0 = SystemClock.elapsedRealtime()
                        try {
                            if (cancelled.get()) {
                                throw PlaylistProbe.PlaylistError("cancelled", "cancelled")
                            }
                            // fetchSegment downloads + AES-128 decrypts → plaintext.
                            val bytes = fetchOne(idx)
                            val ms = SystemClock.elapsedRealtime() - t0
                            fetchMsBySeg[idx] = ms
                            synchronized(this) {
                                fetchCount++
                                fetchTotalMs += ms
                            }
                            bytes
                        } catch (e: PlaylistProbe.PlaylistError) {
                            throw e
                        } catch (e: Exception) {
                            throw PlaylistProbe.PlaylistError(
                                "network",
                                e.message ?: "segment prefetch failed",
                            )
                        }
                    })
                }
            }
        }

        private fun fetchSequential(i: Int): ByteArray {
            val t0 = SystemClock.elapsedRealtime()
            val bytes = try {
                fetchOne(i)
            } catch (e: PlaylistProbe.PlaylistError) {
                throw e
            }
            val ms = SystemClock.elapsedRealtime() - t0
            fetchMsBySeg[i] = ms
            synchronized(this) {
                fetchCount++
                fetchTotalMs += ms
            }
            return bytes
        }
    }

    // ------------------------------------------------------------------

    private fun freshBattery(): List<Extractor> = listOf(
        TsExtractor(TsExtractor.MODE_SINGLE_PMT),
        FragmentedMp4Extractor(),
        Mp4Extractor(),
        AdtsExtractor(),
        Mp3Extractor(),
    )

    private fun partialOrSuccess(collector: SignalCollector, t0: Long): ExtractResult {
        val overBudget = SystemClock.elapsedRealtime() - t0 > BUDGET_MS
        if (overBudget && collector.lastDecodedUs < collector.anchorUs + PARTIAL_MIN_US) {
            return ExtractResult.Error("timeout", "window budget exhausted before enough audio decoded")
        }
        d("signal summary: span=${collector.decodedSpanUs() / 1000}ms " +
            "sileroDuty=${collector.sileroDuty()} energyDuty=${collector.energyDuty()} " +
            "chunks=${collector.totalChunks}")
        return collector.buildSuccess()
            ?: ExtractResult.Error("no-audio-track", "no audio decoded in window")
    }

    private fun classifyIo(e: IOException): ExtractResult.Error {
        var cause: Throwable? = e
        while (cause != null) {
            if (cause is HttpDataSource.InvalidResponseCodeException) {
                val code = cause.responseCode
                return ExtractResult.Error(
                    if (code == 401 || code == 403 || code == 410) "expired-url" else "network",
                    "http $code during extraction",
                )
            }
            cause = cause.cause
        }
        return ExtractResult.Error("network", "network error: ${e.message}")
    }

    /** Read-only in-memory DataSource for buffered HLS segments. */
    private class ByteArrayDataSource2(private val data: ByteArray) :
        androidx.media3.datasource.BaseDataSource(false) {
        private var opened = false
        private var pos = 0

        override fun open(dataSpec: DataSpec): Long {
            pos = dataSpec.position.toInt().coerceIn(0, data.size)
            opened = true
            return (data.size - pos).toLong()
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (!opened) throw IOException("not opened")
            if (pos >= data.size) return -1 // C.RESULT_END_OF_INPUT
            val n = minOf(length, data.size - pos)
            System.arraycopy(data, pos, buffer, offset, n)
            pos += n
            return n
        }

        override fun getUri(): Uri = Uri.EMPTY

        override fun close() {
            opened = false
        }
    }
}
