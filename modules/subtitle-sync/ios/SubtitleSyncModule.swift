import ExpoModulesCore

/// Any runnable native extraction/scan job the module can cancel.
protocol Cancellable {
    func cancel()
}

public class SubtitleSyncModule: Module {
    private var job: Cancellable?

    public func definition() -> ModuleDefinition {
        Name("SubtitleSync")

        Events("onProgress")

        // Local files: AVAssetReader + AVAssetReaderTrackOutput (fast, seek works).
        AsyncFunction("extractAsync") { (uri: String, options: [String: Any], promise: Promise) in
            guard self.job == nil else {
                promise.reject("BUSY", "extraction already running")
                return
            }

            let from = (options["fromSec"] as? NSNumber)?.doubleValue ?? 0.0
            let to = (options["toSec"] as? NSNumber)?.doubleValue ?? 900.0
            let silero = (options["useSilero"] as? Bool) ?? false
            let rawHeaders = options["headers"] as? [String: Any] ?? [:]
            let headers = rawHeaders.mapValues { "\($0)" }
            // audioTrackIndex reserved — v1 decodes first audio track

            let extractJob = AudioExtractJob(
                context: NSNull(),
                uri: uri,
                headers: headers,
                fromSec: from,
                toSec: to,
                useSilero: silero,
                onProgress: { [weak self] p in
                    self?.sendEvent("onProgress", ["progress": p])
                },
                onResult: { [weak self] result in
                    self?.job = nil
                    self?.resolveExtract(result, promise: promise)
                }
            )
            self.job = extractJob
            extractJob.start()
        }

        // Remote sources (progressive `container`): reuse the AVAssetReader path —
        // AVFoundation issues proper range requests for remote progressive files,
        // so no separate headless player is needed. HLS (`container` == "hls")
        // needs a real player + tap, which AudioExtractJob cannot do.
        AsyncFunction("scanAsync") { (uri: String, options: [String: Any], promise: Promise) in
            guard self.job == nil else {
                promise.reject("BUSY", "extraction already running")
                return
            }

            let from = (options["fromSec"] as? NSNumber)?.doubleValue ?? 0.0
            let to = (options["toSec"] as? NSNumber)?.doubleValue ?? 300.0
            let silero = (options["useSilero"] as? Bool) ?? false
            let rawSpeed = options["speed"] as? NSNumber
            let speed = min(max(rawSpeed?.floatValue ?? 2.0, 1.0), 4.0)
            let container = options["container"] as? String ?? "progressive"
            let rawHeaders = options["headers"] as? [String: Any] ?? [:]
            let headers = rawHeaders.mapValues { "\($0)" }

            let scanJob: Cancellable
            if container == "hls" {
                scanJob = HlsScanJob(
                    context: NSNull(),
                    uri: uri,
                    headers: headers,
                    fromSec: from,
                    toSec: to,
                    speed: speed,
                    useSilero: silero,
                    onProgress: { [weak self] p in
                        self?.sendEvent("onProgress", ["progress": p])
                    },
                    onResult: { [weak self] result in
                        self?.job = nil
                        self?.resolveExtract(result, promise: promise)
                    }
                )
            } else {
                scanJob = AudioExtractJob(
                    context: NSNull(),
                    uri: uri,
                    headers: headers,
                    fromSec: from,
                    toSec: to,
                    useSilero: silero,
                    onProgress: { [weak self] p in
                        self?.sendEvent("onProgress", ["progress": p])
                    },
                    onResult: { [weak self] result in
                        self?.job = nil
                        self?.resolveExtract(result, promise: promise)
                    }
                )
            }
            self.job = scanJob
            scanJob.start()
        }

        // Inspect an m3u8 playlist URL without decoding (live/drm/muxed flags +
        // clean errors) so JS can gate or pick scan windows early.
        AsyncFunction("probeAsync") { (uri: String, options: [String: Any], promise: Promise) in
            let rawHeaders = options["headers"] as? [String: Any] ?? [:]
            let headers = rawHeaders.mapValues { "\($0)" }
            PlaylistProbe.probe(playlistUrl: uri, headers: headers) { result in
                switch result {
                case .success(let info):
                    promise.resolve([
                        "ok": true,
                        "live": info.live,
                        "drmProtected": info.drmProtected,
                        "muxedOnly": info.muxedOnly
                    ])
                case .failure(let err):
                    promise.resolve([
                        "ok": false,
                        "code": err.code,
                        "message": err.message
                    ])
                }
            }
        }

        Function("cancel") {
            self.job?.cancel()
            self.job = nil
        }

        OnDestroy {
            self.job?.cancel()
            self.job = nil
        }
    }

    private func resolveExtract(_ result: Result<ExtractSuccess, ExtractError>, promise: Promise) {
        switch result {
        case .success(let s):
            promise.resolve([
                "ok": true,
                "rate": 100,
                "startSec": s.startSec,
                "endSec": s.endSec,
                "bins": s.bins,
                "signalB64": s.signalB64
            ])
        case .failure(let e):
            let code: String
            let message: String
            switch e {
            case .noAudioTrack:
                code = "no-audio-track"; message = "no audio track"
            case .unsupportedFormat:
                code = "unsupported-format"; message = "unsupported format"
            case .unsupportedCodec(let m):
                code = "unsupported-codec"; message = m
            case .network(let m):
                code = "network"; message = m
            case .expiredURL:
                code = "expired-url"; message = "source rejected request"
            case .timeout:
                code = "timeout"; message = "decode stall watchdog"
            case .decodeFailed(let m):
                code = "decode-failed"; message = m
            case .liveUnsupported:
                code = "live-unsupported"; message = "live streams aren't supported"
            case .drmUnsupported:
                code = "drm-unsupported"; message = "drm protected stream"
            }
            promise.resolve(["ok": false, "code": code, "message": message])
        }
    }
}