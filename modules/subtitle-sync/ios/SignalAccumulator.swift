import Foundation

struct SignalOutput {
    let signalB64: String
    let bins: Int
    let endSec: Double
}

/// Converts mono float PCM @ srcRate into the 100Hz bit-packed speech signal.
/// Output bins are indexed in *content* time, not sample time.
///
/// Bit packing is LSB-first inside each byte (byteIdx = b/8, bitIdx = b%8) —
/// identical to Android's BitSet.toByteArray and to what JS decodes.
class SignalAccumulator {
    private let lock = NSLock()
    private let resampler: Resampler
    private let vad: Vad
    private let windowSec: Double?
    private let contentScale: Double

    private var bins: [UInt8] = []
    private var window: [Float] = []
    private var totalOut16k: Int64 = 0
    private(set) var finished = false

    init(srcRate: Int, vad: Vad, windowSec: Double? = nil, contentScale: Double = 1.0) {
        self.resampler = Resampler(srcRate: srcRate, dstRate: 16000)
        self.vad = vad
        self.windowSec = windowSec
        self.contentScale = contentScale
    }

    /// Re-target the input resampler when the source reports a new rate (keeps bins).
    func resetSourceRate(_ srcRate: Int) {
        lock.lock(); defer { lock.unlock() }
        resampler.reset(srcRate: srcRate)
    }

    /// Content-time seconds accumulated so far.
    func contentSec() -> Double {
        lock.lock(); defer { lock.unlock() }
        return Double(totalOut16k) / 16000.0 / contentScale
    }

    func totalSamples() -> Int64 {
        lock.lock(); defer { lock.unlock() }
        return totalOut16k
    }

    /// Returns true when the accumulation window is complete.
    @discardableResult
    func pushMono(_ mono: [Float]) -> Bool {
        lock.lock(); defer { lock.unlock() }
        let up = resampler.push(mono)
        for s in up {
            window.append(s)
            if window.count == 512 {
                let chunk = Array(window)
                window.removeAll(keepingCapacity: true)
                if vad.process(chunk) >= 0.5 {
                    let b0 = Int(Double(totalOut16k) / (160.0 * contentScale))
                    let b1 = Int(Double(totalOut16k + 512) / (160.0 * contentScale))
                    let last = max(b1, b0 + 1)
                    while bins.count <= last / 8 { bins.append(0) }
                    if last > b0 {
                        for b in b0..<last {
                            bins[b / 8] |= UInt8(1 << (b % 8))
                        }
                    }
                }
                totalOut16k += 512
            }
        }
        if let windowSec,
           Double(totalOut16k) / 16000.0 / contentScale >= windowSec {
            finished = true
        }
        return finished
    }

    func output(startSec: Double) -> SignalOutput {
        lock.lock(); defer { lock.unlock() }
        let totalBins = Int((Double(totalOut16k) / contentScale + 159) / 160)
        // §1.3 contract: exactly ceil(bins/8) bytes. Sparse growth stops at the
        // highest set bit, so a silent tail ships short — pad out to full width.
        var bytes = bins
        let needed = (totalBins + 7) / 8
        if bytes.count < needed {
            bytes.append(contentsOf: [UInt8](repeating: 0, count: needed - bytes.count))
        }
        return SignalOutput(
            signalB64: Data(bytes).base64EncodedString(options: []),
            bins: totalBins,
            endSec: startSec + Double(totalOut16k) / 16000.0 / contentScale
        )
    }
}