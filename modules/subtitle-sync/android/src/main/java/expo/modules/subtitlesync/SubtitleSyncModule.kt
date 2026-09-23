package expo.modules.subtitlesync

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SubtitleSyncModule : Module() {
    private var job: AudioExtractJob? = null
    private var scanJob: FastScanJob? = null
    /**
     * R5c Stage B: watch-sync collector — THIRD slot, deliberately OUTSIDE
     * job/scanJob busy gates. A fetch scan and a watch session may run
     * concurrently; only one of each. Cleared by stopWatchSync / OnDestroy.
     */
    private var watchCollector: WatchCollector? = null
    /**
     * F3: snapshot of the last completed scan's status. onResult nulls scanJob
     * BEFORE the promise settles, so a JS flush after await scanAsync() would
     * otherwise read an empty idle map and drop the final trace lines
     * (DONE / hls prefetch stats) that landed after the last 500ms poll.
     */
    @Volatile private var lastScanStatus: Map<String, Any?> =
        mapOf("phase" to "idle", "progress" to 0, "trace" to "", "lineCount" to 0L, "traceLines" to emptyList<String>())

    /**
     * Wait until a cancelled/dying job clears its slot via onResult.
     * cancel() must NOT null the slot immediately — a restart during that
     * window would pass the BUSY check and start a second scan (double
     * bandwidth + interleaved trace lines).
     */
    private fun awaitIdle(timeoutMs: Long = 2000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while ((job != null || scanJob != null) && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(50)
            } catch (_: InterruptedException) {
                break
            }
        }
        return job == null && scanJob == null
    }

    private fun busyResult(message: String) = mapOf(
        "ok" to false,
        "code" to "busy",
        "message" to message,
    )

    override fun definition() = ModuleDefinition {
        Name("SubtitleSync")
        Events("onProgress", "onDebug", "onWatchSignal")

        // Local files: framework MediaExtractor + MediaCodec (fast, seek works).
        AsyncFunction("extractAsync") { uri: String, options: Map<String, Any?>, promise: expo.modules.kotlin.Promise ->
            if ((job != null || scanJob != null) && !awaitIdle(2000)) {
                promise.resolve(busyResult("another extraction is already running"))
                return@AsyncFunction
            }
            if (job != null || scanJob != null) {
                promise.resolve(busyResult("another extraction is already running"))
                return@AsyncFunction
            }
            val from = (options["fromSec"] as? Number)?.toDouble() ?: 0.0
            val to = (options["toSec"] as? Number)?.toDouble() ?: 900.0
            val silero = options["useSilero"] as? Boolean ?: false // EnergyVad default (Silero unreliable on-device)
            val headers = (options["headers"] as? Map<*, *>)
                ?.entries?.associate { it.key.toString() to it.value.toString() } ?: emptyMap()
            @Suppress("UNUSED_VARIABLE")
            val audioTrackIndex = (options["audioTrackIndex"] as? Number)?.toInt() // reserved - v1 decodes first audio track

            val ctx = appContext.reactContext
                ?: throw IllegalStateException("no react context")

            job = AudioExtractJob(
                context = ctx,
                uri = uri,
                headers = headers,
                fromSec = from,
                toSec = to,
                useSilero = silero,
                onProgress = { p -> sendEvent("onProgress", mapOf("progress" to p)) },
                onResult = { r ->
                    job = null
                    resolveExtract(r, promise)
                }
            ).also { it.start() }
        }

        // Remote sources: unclocked direct extraction (FastScanJob).
        //  - progressive: OkHttp + CustomExtractorsFactory (incl. the vendored
        //    SecondarySeekHeadMatroskaExtractor for no-seek MKVs) + MediaCodec.
        //    Decodes as fast as network+CPU allow instead of the old 4x-capped
        //    headless player, and anchors bins on true container PTS.
        //  - hls: playlist parsed directly, audio rendition preferred, segments
        //    fetched/decrypted, per-segment extractors. No player, no audio-sink
        //    tap, no wall-clock anchors.
        // The old RemoteScanJob/HlsScanJob player pipeline is retired.
        AsyncFunction("scanAsync") { uri: String, options: Map<String, Any?>, promise: expo.modules.kotlin.Promise ->
            if ((job != null || scanJob != null) && !awaitIdle(2000)) {
                promise.resolve(busyResult("another scan is already running"))
                return@AsyncFunction
            }
            if (job != null || scanJob != null) {
                // Clean error result (not a rejection): a raw rejection used to
                // surface as an unhandled exception in the UI.
                promise.resolve(busyResult("another scan is already running"))
                return@AsyncFunction
            }
            val from = (options["fromSec"] as? Number)?.toDouble() ?: 0.0
            val to = (options["toSec"] as? Number)?.toDouble() ?: 300.0
            val silero = options["useSilero"] as? Boolean ?: false // EnergyVad default (Silero unreliable on-device)
            @Suppress("UNUSED_VARIABLE")
            val speed = ((options["speed"] as? Number)?.toFloat() ?: 2f).coerceIn(1f, 4f) // unused: unclocked engine
            val container = options["container"] as? String ?: "progressive"
            val vadDebug = options["vadDebug"] as? Boolean ?: false // R5-3
    val preferredLang = options["audioLang"] as? String
            // Stage D: Silero mark-threshold hysteresis from JS (null → F6 defaults).
            val vadMarkOn = (options["vadMarkOn"] as? Number)?.toFloat()
            val vadMarkOff = (options["vadMarkOff"] as? Number)?.toFloat()
            // G1/G3/G4-3: governor knobs from JS (player-aware budget + NetInfo).
            val throttleMbps = (options["throttleMbps"] as? Number)?.toDouble() ?: 0.0
            val cellular = options["cellular"] as? Boolean ?: false
            val allowConfirmBytes = options["allowConfirmBytes"] as? Boolean ?: false
            val headers = (options["headers"] as? Map<*, *>)
                ?.entries?.associate { it.key.toString() to it.value.toString() } ?: emptyMap()

            val ctx = appContext.reactContext
                ?: throw IllegalStateException("no react context")

            var theJob: FastScanJob? = null
            theJob = FastScanJob(
                context = ctx,
                uri = uri,
                headers = headers,
                fromSec = from,
                toSec = to,
                useSilero = silero,
                container = container,
                preferredLang = preferredLang,
                onProgress = { p -> sendEvent("onProgress", mapOf("progress" to p)) },
                onDebug = { msg ->
                    // Full pipeline trace straight into the Metro console.
                    sendEvent("onDebug", mapOf("message" to msg))
                },
                vadDebug = vadDebug,
                vadMarkOn = vadMarkOn,
                vadMarkOff = vadMarkOff,
                throttleMbps = throttleMbps,
                cellular = cellular,
                allowConfirmBytes = allowConfirmBytes,
                onResult = { r ->
                    // Capture final status BEFORE nulling the slot so a
                    // post-await JS flush can still print trailing lines (F3).
                    theJob?.status()?.let { lastScanStatus = it }
                    scanJob = null
                    // Attach the full pipeline trace to the outcome: errors carry
                    // it in the message tail so it reaches the JS console even if
                    // event delivery is unavailable.
                    val trace = theJob?.debugTrace() ?: ""
                    val enriched = when (r) {
                        is ExtractResult.Error -> ExtractResult.Error(r.code, r.message + "\n---trace---\n" + trace)
                        else -> r
                    }
                    resolveExtract(enriched, promise)
                }
            )
            val started = requireNotNull(theJob)
            scanJob = started
            started.start()
        }

        // Inspect an m3u8 playlist URL without decoding: live/drm/muxed flags
        // plus clean "expired-url" / "unsupported-format" / "network" errors so
        // JS can gate or pick scan windows before spending decode time.
        AsyncFunction("probeAsync") { uri: String, options: Map<String, Any?>, promise: expo.modules.kotlin.Promise ->
            val headers = (options["headers"] as? Map<*, *>)
                ?.entries?.associate { it.key.toString() to it.value.toString() } ?: emptyMap()
            CoroutineScope(Dispatchers.IO).launch {
                val r = PlaylistProbe.probe(uri, headers)
                r.fold(
                    onSuccess = { info ->
                        promise.resolve(
                            mapOf(
                                "ok" to true,
                                "live" to info.live,
                                "drmProtected" to info.drmProtected,
                                "muxedOnly" to info.muxedOnly
                            )
                        )
                    },
                    onFailure = { err ->
                        val pe = err as? PlaylistProbe.PlaylistError
                        promise.resolve(
                            mapOf(
                                "ok" to false,
                                "code" to (pe?.code ?: "network"),
                                "message" to (pe?.message ?: "probe failed")
                            )
                        )
                    }
                )
            }
        }

        // Pollable status (phase + progress + live trace) - the UI can poll
        // this if event delivery is unavailable. After the job finishes (slot
        // already null) fall back to lastScanStatus so the JS flush can still
        // read trailing lines (F3).
        Function("scanStatus") {
            (scanJob as? FastScanJob)?.status() ?: lastScanStatus
        }

        Function("cancel") {
            // Mark cancelled only — the slot is cleared in onResult when the
            // worker thread actually exits, so a restart during teardown waits
            // (awaitIdle) instead of racing a second scan against the dying one.
            job?.cancel()
            scanJob?.cancel()
        }

        // G2: player rebuffer flag — FastScanJob pauses reads while true.
        Function("setPlayerStruggling") { struggling: Boolean ->
            FastScanJob.playerStruggling = struggling
        }

        // A5: isolation probe for the playback PCM tap (Stage A). Reads the
        // static PlayerAudioTap counters — no watch session required. Reset
        // with tapProbeReset so a rate measurement starts from zero.
        Function("tapProbe") {
            expo.modules.video.utils.PlayerAudioTap.snapshot()
        }
        Function("tapProbeReset") {
            expo.modules.video.utils.PlayerAudioTap.resetCounters()
            true
        }

        // I-4: rolling player-throughput (Mbps) from expo-video's
        // PlayerTraffic meter (fed by every PlayerHttp response body read).
        // Returns -1 when no samples yet → JS uses PLAYER_FALLBACK_MBPS.
        Function("playerThroughputMbps") {
            expo.modules.video.PlayerTraffic.mbpsLast5s()
        }

        // ─── Stage B: watch-sync (third slot — NOT gated by awaitIdle) ───
        // activateWatchSync / watchAnchor / stopWatchSync + onWatchSignal.
        // Lives outside job/scanJob so a concurrent fetch scan is allowed.

        AsyncFunction("activateWatchSync") { options: Map<String, Any?>, promise: expo.modules.kotlin.Promise ->
            val fromSec = (options["fromSec"] as? Number)?.toDouble() ?: 0.0
            val windowSec = (options["windowSec"] as? Number)?.toDouble() ?: 90.0
            val silero = options["useSilero"] as? Boolean ?: false
            val vadMarkOn = (options["vadMarkOn"] as? Number)?.toFloat()
            val vadMarkOff = (options["vadMarkOff"] as? Number)?.toFloat()
            val ctx = appContext.reactContext
                ?: throw IllegalStateException("no react context")
            // Replace any existing session first (activate emits its partial).
            watchCollector?.stop()
            val collector = WatchCollector(
                context = ctx,
                useSilero = silero,
                vadMarkOn = vadMarkOn,
                vadMarkOff = vadMarkOff,
                onSignal = { r ->
                    sendEvent(
                        "onWatchSignal",
                        mapOf(
                            "ok" to true,
                            "rate" to 100,
                            "startSec" to r.startSec,
                            "endSec" to r.endSec,
                            "bins" to r.bins,
                            "signalB64" to r.signalB64,
                            "vadChose" to (r.vadChose ?: ""),
                            "sileroDuty" to (r.sileroDuty?.toDouble() ?: 0.0),
                            "energyDuty" to (r.energyDuty?.toDouble() ?: 0.0),
                            "sileroMaxProb" to (r.sileroMaxProb?.toDouble() ?: 0.0),
                            "totalChunks" to (r.totalChunks ?: 0L),
                        ),
                    )
                },
                log = { msg ->
                    sendEvent("onDebug", mapOf("message" to msg))
                },
            )
            watchCollector = collector
            collector.activate(fromSec, windowSec)
            promise.resolve(
                mapOf(
                    "ok" to true,
                    "active" to collector.isActive(),
                    "anchorSec" to fromSec,
                    "windowSec" to windowSec,
                )
            )
        }

        Function("watchAnchor") { toSec: Double ->
            watchCollector?.anchor(toSec)
            watchCollector != null
        }

        Function("stopWatchSync") {
            watchCollector?.stop()
            watchCollector = null
            true
        }

        Function("watchSyncStatus") {
            watchCollector?.status() ?: mapOf("active" to false)
        }

        OnDestroy {
            job?.cancel()
            job = null
            scanJob?.cancel()
            scanJob = null
            // Stage B owns PlayerAudioTap.listener — clear on teardown so a
            // dead module never keeps feeding a stale collector.
            watchCollector?.stop()
            watchCollector = null
            expo.modules.video.utils.PlayerAudioTap.listener = null
        }
    }

    private fun resolveExtract(r: ExtractResult, promise: expo.modules.kotlin.Promise) {
        when (r) {
            is ExtractResult.Success -> {
                val map = mutableMapOf<String, Any?>(
                    "ok" to true,
                    "rate" to 100,
                    "startSec" to r.startSec,
                    "endSec" to r.endSec,
                    "bins" to r.bins,
                    "signalB64" to r.signalB64,
                )
                // R8-3: VAD verdict diagnostics ride the success payload.
                r.vadChose?.let { map["vadChose"] = it }
                r.sileroDuty?.let { map["sileroDuty"] = it.toDouble() }
                r.energyDuty?.let { map["energyDuty"] = it.toDouble() }
                r.sileroMaxProb?.let { map["sileroMaxProb"] = it.toDouble() }
                r.totalChunks?.let { map["totalChunks"] = it }
                promise.resolve(map)
            }
            is ExtractResult.Error -> promise.resolve(
                mapOf(
                    "ok" to false,
                    "code" to r.code,
                    "message" to r.message
                )
            )
        }
    }
}
