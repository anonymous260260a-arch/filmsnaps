import AVFoundation

enum ExtractError: Error {
    case noAudioTrack
    case unsupportedFormat
    case unsupportedCodec(String)
    case network(String)
    case expiredURL
    case timeout
    case decodeFailed(String)
    case liveUnsupported
    case drmUnsupported
}

struct ExtractSuccess {
    let startSec: Double
    let endSec: Double
    let signalB64: String
    let bins: Int
}

/// Common VAD protocol — EnergyVad and SileroVad both conform.
protocol Vad {
    func process(_ chunk: [Float]) -> Float
    func reset()
}

/// Energy-based VAD — same algorithm as the Android EnergyVad.
class EnergyVad: Vad {
    private var noiseFloor: Float = 1e-4
    private var warmup = 0

    func reset() {
        noiseFloor = 1e-4
        warmup = 0
    }

    func process(_ chunk: [Float]) -> Float {
        var sum: Float = 0
        for v in chunk { sum += v * v }
        let rms = sqrt(sum / Float(chunk.size))

        if warmup < 100 || rms < noiseFloor * 2 {
            noiseFloor += (rms - noiseFloor) * 0.02
        } else {
            noiseFloor += (rms - noiseFloor) * 0.0005
        }
        warmup += 1

        let ratio = rms / (noiseFloor * 3.2 + 1e-6)
        return min(max(ratio, 0), 1)
    }
}

/// Linear interpolation resampler to 16kHz.
class Resampler {
    private let dstRate: Int
    private var step: Double
    private var t: Double = 0
    private var prev: Float = .nan

    init(srcRate: Int, dstRate: Int = 16000) {
        self.dstRate = dstRate
        self.step = Double(srcRate) / Double(dstRate)
    }

    func reset(srcRate: Int) {
        step = Double(srcRate) / Double(dstRate)
        t = 0
        prev = .nan
    }

    func push(_ x: [Float]) -> [Float] {
        if step == 1.0 { return x }
        if prev.isNaN { prev = x[0] }
        let n = x.count
        var out = [Float]()
        out.reserveCapacity(Int(Double(n) / step) + 2)
        while t <= Double(n - 1) {
            let i = Int(t)
            let frac = Float(t - Double(i))
            let a = (i == 0) ? prev : x[i - 1]
            let b = x[i]
            out.append(a + (b - a) * frac)
            t += step
        }
        t -= Double(n)
        prev = x[n - 1]
        return out
    }
}

class AudioExtractJob {
    let context: Any // unused on iOS, kept for API parity
    let uri: String
    let headers: [String: String]
    let fromSec: Double
    let toSec: Double
    let useSilero: Bool
    let onProgress: (Float) -> Void
    let onResult: (Result<ExtractSuccess, ExtractError>) -> Void

    private var isCancelled = false
    private var reader: AVAssetReader?

    init(
        context: Any,
        uri: String,
        headers: [String: String],
        fromSec: Double,
        toSec: Double,
        useSilero: Bool,
        onProgress: @escaping (Float) -> Void,
        onResult: @escaping (Result<ExtractSuccess, ExtractError>) -> Void
    ) {
        self.context = context
        self.uri = uri
        self.headers = headers
        self.fromSec = fromSec
        self.toSec = toSec
        self.useSilero = useSilero
        self.onProgress = onProgress
        self.onResult = onResult
    }

    func cancel() { isCancelled = true }

    func start() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let result = self.extract()
            self.onResult(result)
        }
    }

    private func extract() -> Result<ExtractSuccess, ExtractError> {
        let url = URL(string: uri) ?? URL(fileURLWithPath: uri)
        let isRemote = uri.hasPrefix("http")

        // Build asset with headers for remote URLs
        let asset: AVURLAsset
        if isRemote && !headers.isEmpty {
            asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        } else {
            asset = AVURLAsset(url: url)
        }

        // Validate range support for remote
        // Note: AVFoundation issues range requests automatically for AVAssetReader

        // Set up reader
        let readerObj: AVAssetReader
        do {
            readerObj = try AVAssetReader(asset: asset)
        } catch {
            if isRemote {
                let msg = error.localizedDescription.lowercased()
                if msg.contains("403") || msg.contains("401") || msg.contains("410") {
                    return .failure(.expiredURL)
                }
                return .failure(.network(error.localizedDescription))
            }
            return .failure(.decodeFailed(error.localizedDescription))
        }
        self.reader = readerObj

        // Find audio track
        let audioTracks = asset.tracks(withMediaType: .audio)
        guard let audioTrack = audioTracks.first else {
            return .failure(.noAudioTrack)
        }

        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1
        ]

        let trackOutput = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: outputSettings)
        guard readerObj.canAdd(trackOutput) else {
            return .failure(.unsupportedFormat)
        }
        readerObj.add(trackOutput)

        // Set time range
        let start = CMTime(seconds: fromSec, preferredTimescale: 600)
        let end = CMTime(seconds: toSec, preferredTimescale: 600)
        readerObj.timeRange = CMTimeRange(start: start, end: end)

        guard readerObj.startReading() else {
            let err = readerObj.error
            let msg = (err as NSError?)?.localizedDescription ?? "reader error"
            if isRemote {
                if msg.contains("403") || msg.contains("401") { return .failure(.expiredURL) }
                return .failure(.network(msg))
            }
            return .failure(.decodeFailed(msg))
        }

        // VAD + signal generation — mirrors the Android pipeline exactly
        let vad: Vad = useSilero ? (SileroVad() ?? EnergyVad()) : EnergyVad()
        vad.reset()
        let resampler = Resampler(srcRate: 44100, dstRate: 16000)
        var window = [Float]()
        window.reserveCapacity(512)
        var bins = [UInt8]()
        var totalOut16k: Int64 = 0
        var startSec: Double = -1
        var lastProgress: Float = 0

        // Stall watchdog
        let stallMs: Double = isRemote
            ? 300_000 + (toSec - fromSec) * 1000
            : 120_000 + (toSec - fromSec) * 250
        var lastOutputAt = Date().timeIntervalSince1970 * 1000

        while !isCancelled {
            if Date().timeIntervalSince1970 * 1000 - lastOutputAt > stallMs {
                return .failure(.timeout)
            }

            guard let sampleBuffer = trackOutput.copyNextSampleBuffer() else {
                if readerObj.status == .reading {
                    // EOS or transient gap
                    break
                }
                if readerObj.status == .failed {
                    let msg = readerObj.error?.localizedDescription ?? "reader failed"
                    if isRemote { return .failure(.network(msg)) }
                    return .failure(.decodeFailed(msg))
                }
                break
            }

            lastOutputAt = Date().timeIntervalSince1970 * 1000

            // Extract PCM data
            guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { continue }
            var totalLength = 0
            let _ = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: &totalLength, totalLengthOut: nil, dataPointerOut: nil)
            var dataPointer: UnsafeMutablePointer<Int8>?
            let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)
            guard status == noErr, let ptr = dataPointer else { continue }

            let sampleCount = totalLength / 2 // 16-bit samples
            let samples = UnsafeBufferPointer(start: UnsafeRawPointer(ptr).bindMemory(to: Int16.self, capacity: sampleCount), count: sampleCount)

            // Get PTS for timing
            let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            let ptsSec = CMTimeGetSeconds(pts)
            if startSec < 0 { startSec = ptsSec }

            // Downmix to mono float
            let frames = sampleCount // already mono from output settings
            var mono = [Float]()
            mono.reserveCapacity(frames)
            for i in 0..<frames {
                mono.append(Float(samples[i]) / 32768.0)
            }

            let up = resampler.push(mono)
            var k = 0
            while k < up.count {
                window.append(up[k])
                k += 1
                if window.count == 512 {
                    let chunk = Array(window)
                    window.removeAll(keepingCapacity: true)
                    let prob = vad.process(chunk)
                    if prob >= 0.5 {
                        let b0 = Int(totalOut16k / 160)
                        let b1 = Int((totalOut16k + 512) / 160)
                        // Ensure bins array is large enough
                        while bins.count <= b1 / 8 {
                            bins.append(0)
                        }
                        for b in b0..<b1 {
                            let byteIdx = b / 8
                            let bitIdx = b % 8
                            if byteIdx < bins.count {
                                bins[byteIdx] |= UInt8(1 << bitIdx)
                            }
                        }
                    }
                    totalOut16k += 512
                }
            }

            // Progress
            let p = Float((ptsSec - fromSec) / (toSec - fromSec))
            if p - lastProgress > 0.02 {
                lastProgress = min(max(p, 0), 1)
                onProgress(lastProgress)
            }
        }

        reader?.cancelReading()
        reader = nil

        if isCancelled { return .failure(.decodeFailed("cancelled")) }

        let totalBins = Int((totalOut16k + 159) / 160)
        // §1.3 contract: exactly ceil(bins/8) bytes. Sparse growth stops at the
        // highest set bit, so a silent tail ships short — pad out to full width.
        var bytes = bins
        let needed = (totalBins + 7) / 8
        if bytes.count < needed {
            bytes.append(contentsOf: [UInt8](repeating: 0, count: needed - bytes.count))
        }
        let signalData = Data(bytes)
        let b64 = signalData.base64EncodedString(options: [])

        return .success(ExtractSuccess(
            startSec: startSec >= 0 ? startSec : fromSec,
            endSec: startSec >= 0 ? startSec + Double(totalOut16k) / 16000.0 : toSec,
            signalB64: b64,
            bins: totalBins
        ))
    }
}
