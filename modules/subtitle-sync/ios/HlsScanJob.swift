import AVFoundation
import Foundation
import MediaToolbox

/// Headless AVPlayer that plays an HLS (.m3u8) URL muted at up to 2× with an
/// MTAudioProcessingTap spliced into the audio pipeline, tapping decoded PCM
/// into a windowed [SignalAccumulator] (100Hz speech bins in content time) and
/// stops when the accumulation window completes.
///
/// The media list is probed via [PlaylistProbe] so live / malformed / DRM
/// fail fast with clean errors before a player is built.
///
/// The tap runs on the audio render thread; all state it touches is guarded by
/// `lock`. `finish`/`finishSuccess` acquire the lock internally and must be
/// called WITHOUT the lock already held.
final class HlsScanJob: Cancellable {
    private let lock = NSLock()
    let context: Any
    let uri: String
    let headers: [String: String]
    let fromSec: Double
    let toSec: Double
    let useSilero: Bool
    let onProgress: (Float) -> Void
    let onResult: (Result<ExtractSuccess, ExtractError>) -> Void

    private let speed: Float
    private let accumulator: SignalAccumulator

    private var player: AVPlayer?
    private var item: AVPlayerItem?
    private var tap: MTAudioProcessingTap?
    private var pollTimer: DispatchSourceTimer?
    private let pollQueue = DispatchQueue(label: "subsys.hls.poll")

    // Set from the tap's prepare callback (ASBD of the tapped pipeline).
    private var fmtChannels: Int = 2
    private var fmtIsFloat: Bool = false

    private var isCancelled = false
    private var finished = false
    private var lastPcmWallMs: Double = -1
    private var startSec: Double = -1
    private var firstPcmSeen = false

    init(
        context: Any,
        uri: String,
        headers: [String: String],
        fromSec: Double,
        toSec: Double,
        speed: Float,
        useSilero: Bool,
        onProgress: @escaping (Float) -> Void,
        onResult: @escaping (Result<ExtractSuccess, ExtractError>) -> Void
    ) {
        self.context = context
        self.uri = uri
        self.headers = headers
        self.fromSec = fromSec
        self.toSec = toSec
        self.speed = min(speed, 2.0) // iOS tap pipeline is stable up to 2×
        self.useSilero = useSilero
        self.onProgress = onProgress
        self.onResult = onResult

        let vad: Vad = useSilero ? (SileroVad() ?? EnergyVad()) : EnergyVad()
        vad.reset()
        self.accumulator = SignalAccumulator(srcRate: 48000, vad: vad, windowSec: toSec - fromSec)
    }

    func cancel() {
        lock.lock()
        isCancelled = true
        lock.unlock()
        finish(.failure(.decodeFailed("cancelled")))
    }

    func start() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            PlaylistProbe.probe(playlistUrl: self.uri, headers: self.headers) { result in
                switch result {
                case .failure(let err):
                    self.finish(.failure(self.fromProbeError(err)))
                case .success(let info):
                    if info.live {
                        self.finish(.failure(.liveUnsupported))
                    } else if info.drmProtected {
                        self.finish(.failure(.drmUnsupported))
                    } else {
                        DispatchQueue.main.async { self.buildPlayer() }
                    }
                }
            }
        }
    }

    private func fromProbeError(_ err: PlaylistError) -> ExtractError {
        if err.code == "expired-url" { return .expiredURL }
        if err.code == "network" { return .network(err.message) }
        return .unsupportedFormat
    }

    private func buildPlayer() {
        guard let url = URL(string: uri) else {
            finish(.failure(.decodeFailed("invalid url")))
            return
        }
        let asset: AVURLAsset
        if !headers.isEmpty {
            asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        } else {
            asset = AVURLAsset(url: url)
        }
        let item = AVPlayerItem(asset: asset)
        self.item = item

        let player = AVPlayer(playerItem: item)
        self.player = player
        player.automaticallyWaitsToMinimizeStalling = false
        player.isMuted = true
        player.volume = 0
        item.audioTimePitchAlgorithm = .spectral

        installTap(on: item)

        // Start near the requested window; VOD playlists seek fine, unseekable
        // LIVEs fall into PREROLL territory handled by the poll loop.
        player.seek(to: CMTime(seconds: fromSec, preferredTimescale: 600)) { _ in
            player.play()
        }
        player.rate = speed

        startPolling()
    }

    private func installTap(on item: AVPlayerItem) {
        let jobPtr = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        var callbacks = MTAudioProcessingTapCallbacks(
            version: kMTAudioProcessingTapCallbacksVersion_0,
            clientInfo: jobPtr,
            init: { _, clientInfo, tapStorageOut in
                guard let clientInfo else { return kMTAudioProcessingTapCreationError_SourceUnavailable }
                tapStorageOut?.initialize(to: clientInfo)
                return noErr
            },
            finalize: { _ in },
            prepare: { tap, _, processingFormat in
                guard let tap, let clientInfo = MTAudioProcessingTapGetStorage(tap) else { return }
                let job = Unmanaged<HlsScanJob>.fromOpaque(clientInfo).takeUnretainedValue()
                if let fmt = processingFormat?.pointee, fmt.mFormatID == kAudioFormatLinearPCM {
                    job.fmtChannels = max(Int(fmt.mChannelsPerFrame), 1)
                    job.fmtIsFloat = (fmt.mFormatFlags & kAudioFormatFlagIsFloat) != 0
                }
            },
            unprepare: { _ in },
            process: { tap, numberFrames, flags, bufferListInOut, numberFramesOut, flagsOut in
                guard let clientInfo = MTAudioProcessingTapGetStorage(tap) else { return }
                let job = Unmanaged<HlsScanJob>.fromOpaque(clientInfo).takeUnretainedValue()
                job.processTap(
                    tap,
                    numberFrames: numberFrames,
                    flags: flags,
                    bufferListInOut: bufferListInOut,
                    numberFramesOut: numberFramesOut,
                    flagsOut: flagsOut
                )
            }
        )

        guard let tap = MTAudioProcessingTap(callbacks: &callbacks) else { return }
        self.tap = tap

        let params = AVMutableAudioMixInputParameters()
        params.audioTapProcessor = tap
        let mix = AVMutableAudioMix()
        mix.inputParameters = [params]
        item.audioMix = mix
    }

    private func processTap(
        _ tap: MTAudioProcessingTap,
        numberFrames: Int,
        flags: MTAudioProcessingTapFlags,
        bufferListInOut: UnsafeMutablePointer<AudioBufferList>?,
        numberFramesOut: UnsafeMutablePointer<Int>?,
        flagsOut: UnsafeMutablePointer<MTAudioProcessingTapFlags>?
    ) {
        guard let bufferListInOut else { return }
        lock.lock()
        let stop = isCancelled || finished
        lock.unlock()
        if stop { return }

        var timeRange = CMTimeRange()
        var sourceFlags = MTAudioProcessingTapFlags(mutableFlags: 0)
        let outFrames = MTAudioProcessingTapGetSourceAudio(
            tap,
            numberFrames,
            &timeRange,
            &sourceFlags,
            bufferListInOut,
            numberFramesOut
        )
        if outFrames < 0 { return }

        let mono = extractMono(from: bufferListInOut, frameCount: Int(outFrames))
        guard !mono.isEmpty else { return }

        let now = CACurrentMediaTime()
        lock.lock()
        if !firstPcmSeen {
            firstPcmSeen = true
            let anchor = player?.currentTime().seconds ?? fromSec
            startSec = anchor.isNaN ? fromSec : anchor
        }
        lastPcmWallMs = now
        lock.unlock()

        let done = accumulator.pushMono(mono)
        if done {
            finishSuccess(reason: "window-complete", startSec: startSec)
        }
    }

    private func extractMono(
        from bufferListInOut: UnsafeMutablePointer<AudioBufferList>,
        frameCount: Int
    ) -> [Float] {
        lock.lock()
        let channels = fmtChannels
        let isFloat = fmtIsFloat
        lock.unlock()
        guard frameCount > 0, channels > 0 else { return [] }

        let abl = bufferListInOut.pointee
        let buffer = abl.mBuffers
        guard let data = buffer.mData else { return [] }
        let bytes = min(Int(buffer.mDataByteSize), frameCount * channels * (isFloat ? 4 : 2))
        let frames = isFloat
            ? bytes / (4 * channels)
            : bytes / (2 * channels)

        var mono = [Float]()
        mono.reserveCapacity(frames)
        let ptr = data.assumingMemoryBound(to: UInt8.self)
        if isFloat {
            let floats = ptr.withMemoryRebound(to: Float.self, capacity: frames * channels) {
                Array(UnsafeBufferPointer(start: $0, count: frames * channels))
            }
            for f in 0..<frames {
                var s: Float = 0
                for c in 0..<channels { s += floats[f * channels + c] }
                let m = s / Float(channels)
                mono.append(min(max(m, -1), 1))
            }
        } else {
            let shorts = ptr.withMemoryRebound(to: Int16.self, capacity: frames * channels) {
                Array(UnsafeBufferPointer(start: $0, count: frames * channels))
            }
            for f in 0..<frames {
                var s: Int32 = 0
                for c in 0..<channels { s += Int32(shorts[f * channels + c]) }
                mono.append(Float(s) / 32768.0 / Float(channels))
            }
        }
        return mono
    }

    private func startPolling() {
        let timer = DispatchSource.makeTimerSource(queue: pollQueue)
        timer.schedule(deadline: .now() + 0.5, repeating: 0.5)
        timer.setEventHandler { [weak self] in
            self?.poll()
        }
        timer.resume()
        lock.lock()
        pollTimer = timer
        lock.unlock()
    }

    private func poll() {
        lock.lock()
        if finished || isCancelled {
            lock.unlock()
            return
        }
        let content = startSec >= 0 ? startSec + accumulator.contentSec() : -1
        let itemFailed = player?.currentItem?.status == .failed
        let stall = startSec >= 0 && accumulator.totalSamples() > 0 &&
            lastPcmWallMs > 0 && CACurrentMediaTime() - lastPcmWallMs > 90
        let windowDone = accumulator.finished || (content >= 0 && content >= toSec)
        let position = content >= 0 ? content : (player?.currentTime().seconds ?? fromSec)
        lock.unlock()

        if stall {
            finish(.failure(.timeout))
            return
        }
        if windowDone {
            finishSuccess(reason: "window-complete", startSec: startSec)
            return
        }
        if itemFailed {
            let codeInt = (player?.currentItem?.error?.code as? Int) ?? -1
            let e = codeInt == 4300 || codeInt == 4261 ? ExtractError.expiredURL : ExtractError.drmUnsupported
            finish(.failure(e))
            return
        }

        let p = Float((position.isNaN ? fromSec : position - fromSec) / max(toSec - fromSec, 1))
        onProgress(min(max(p, 0), 1))
    }

    private func finishSuccess(reason: String, startSec: Double) {
        lock.lock()
        let hasSignal = startSec >= 0 && accumulator.totalSamples() > 0
        let out = hasSignal ? accumulator.output(startSec: startSec) : nil
        lock.unlock()

        if let out {
            finish(.success(ExtractSuccess(
                startSec: startSec,
                endSec: out.endSec,
                signalB64: out.signalB64,
                bins: out.bins
            )))
        } else {
            finish(.failure(.noAudioTrack))
        }
    }

    private func finish(_ result: Result<ExtractSuccess, ExtractError>) {
        lock.lock()
        if finished {
            lock.unlock()
            return
        }
        finished = true
        pollTimer?.cancel()
        pollTimer = nil
        self.tap = nil
        item?.cancelPendingSeeks()
        item?.audioMix = nil
        player?.pause()
        player?.rate = 0
        player = nil
        item = nil
        let cancelled = isCancelled
        lock.unlock()

        if cancelled {
            onResult(.failure(.decodeFailed("cancelled")))
        } else {
            onResult(result)
        }
    }
}