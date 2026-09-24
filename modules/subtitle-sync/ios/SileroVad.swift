import Foundation
import onnxruntime

/// Silero VAD v5 — neural network voice activity detection.
/// Model: silero_vad.onnx from snakers4/silero-vad
///
/// Tensor contract (v5 @16kHz):
///   inputs:  input  float32 [1,512],  state float32 [2,1,128],  sr int64 scalar 16000
///   outputs: output float32 [1,1],   stateN float32 [2,1,128]
///
/// Chunk size: exactly 512 samples @ 16kHz.
class SileroVad: Vad {
    private var session: ORTSession?
    private var state: [Float] = Array(repeating: 0, count: 2 * 1 * 128)

    init?() {
        guard let modelURL = Bundle.main.url(forResource: "silero_vad", withExtension: "onnx") else {
            print("[SileroVad] Model file not found in bundle")
            return nil
        }
        do {
            let env = try ORTEnv()
            session = try ORTSession(env: env, modelPath: modelURL.path)
        } catch {
            print("[SileroVad] Failed to load model: \(error)")
            return nil
        }
    }

    func reset() {
        state = Array(repeating: 0, count: 2 * 1 * 128)
    }

    func process(_ chunk: [Float]) -> Float {
        guard chunk.count == 512, let session = session else { return 0 }
        do {
            let env = try ORTEnv()

            // input: [1, 512]
            let inputData = chunk.map { NSNumber(value: $0) }
            let inputTensor = try ORTValue(
                tensorData: inputData,
                type: .float,
                shape: [1, 512]
            )

            // state: [2, 1, 128]
            let stateData = state.map { NSNumber(value: $0) }
            let stateTensor = try ORTValue(
                tensorData: stateData,
                type: .float,
                shape: [2, 1, 128]
            )

            // sr: scalar 16000
            let srData = [NSNumber(value: Int64(16000))]
            let srTensor = try ORTValue(
                tensorData: srData,
                type: .int64,
                shape: []
            )

            let inputs: [String: ORTValue] = [
                "input": inputTensor,
                "state": stateTensor,
                "sr": srTensor,
            ]

            let outputs = try session.run(withInputs: inputs, outputNames: ["output", "stateN"])

            // output: [1,1]
            guard let outputValue = outputs["output"],
                  let outputData = try outputValue.tensorData() as? [NSNumber] else {
                return 0
            }
            let prob = outputData[0].floatValue

            // stateN: [2,1,128] → feed back
            if let stateNValue = outputs["stateN"],
               let stateNData = try stateNValue.tensorData() as? [NSNumber] {
                for i in 0..<min(state.count, stateNData.count) {
                    state[i] = stateNData[i].floatValue
                }
            }

            return min(max(prob, 0), 1)
        } catch {
            print("[SileroVad] Inference error: \(error)")
            return 0
        }
    }
}
