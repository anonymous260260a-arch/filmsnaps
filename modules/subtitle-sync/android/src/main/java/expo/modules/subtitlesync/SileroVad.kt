package expo.modules.subtitlesync

import android.content.Context
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import java.nio.FloatBuffer
import java.nio.LongBuffer

/**
 * Silero VAD v5 — neural network voice activity detection.
 * Model: silero_vad.onnx from snakers4/silero-vad (sha256 recorded in module README).
 *
 * Tensor contract (v5 @16kHz):
 *   inputs:  input  float32 [1,512],  state float32 [2,1,128],  sr int64 scalar 16000
 *   outputs: output float32 [1,1],   stateN float32 [2,1,128]
 *
 * Chunk size: exactly 512 samples @ 16kHz.
 */
class SileroVad(
    context: Context,
    /** R5-3: log the model's declared tensor contract and the first probabilities. */
    private val debug: Boolean = false,
    private val log: ((String) -> Unit)? = null,
) : Vad {
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val state = FloatArray(STATE_SIZE) // zero-initialized
    private val probSample = FloatArray(PROB_SAMPLE)
    private var probSampleCount = 0
    private var processCount = 0

    /** Highest probability seen this session — dead-model signature when all probs < 0.05. */
    var maxProb = 0f
        private set
    /** Sum of probabilities (for mean, diagnostics). */
    private var probSum = 0f

    init {
        val bytes = context.assets.open("silero_vad.onnx").use { it.readBytes() }
        session = env.createSession(bytes)
        if (debug) {
            // R5-3: "fires 0" means either the model/opset is not what we think
            // it is, or we are feeding tensors that do not match. Log what the
            // model DECLARES against what process() builds below.
            log?.invoke(
                "silero[debug]: model ${bytes.size}B inputs=${session.inputInfo.size} outputs=${session.outputInfo.size}"
            )
            for ((name, info) in session.inputInfo) {
                val ti = info.info as? TensorInfo
                log?.invoke(
                    "silero[debug]: input '$name' shape=${ti?.shape?.toList()} dtype=${ti?.type}"
                )
            }
            for ((name, info) in session.outputInfo) {
                val ti = info.info as? TensorInfo
                log?.invoke(
                    "silero[debug]: output '$name' shape=${ti?.shape?.toList()} dtype=${ti?.type}"
                )
            }
            log?.invoke("silero[debug]: feeding input[1,512] float32, state[2,1,128] float32, sr int64=16000")
        }
    }

    override fun reset() {
        state.fill(0f)
        maxProb = 0f
        probSum = 0f
        probSampleCount = 0
        processCount = 0
    }

    override fun process(chunk: FloatArray): Float {
        require(chunk.size == 512) { "SileroVad requires exactly 512 samples, got ${chunk.size}" }

        processCount++
        if (debug && processCount <= HEAD_SAMPLE_CHUNKS) {
            // Phase-2 input-path evidence: healthy 16kHz speech = varied
            // +/-0.001..0.3; degenerate (all~0 / clipped +/-1 / constant)
            // means the resampler/channel/format path is broken BEFORE the model.
            var sq = 0f
            for (v in chunk) sq += v * v
            val rms = kotlin.math.sqrt(sq / chunk.size)
            val head = chunk.take(16).joinToString(",") {
                String.format(java.util.Locale.US, "%.4f", it)
            }
            log?.invoke("silero[debug]: chunk#$processCount rms=${"%.4f".format(java.util.Locale.US, rms)} head=[$head]")
        }

        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(chunk), longArrayOf(1, 512))
        val stateTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(state), longArrayOf(2, 1, 128))
        val srTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(16000)), LongArray(0))

        try {
            session.run(mapOf("input" to inputTensor, "state" to stateTensor, "sr" to srTensor)).use { outputs ->
                // output: [1,1] → speech probability
                @Suppress("UNCHECKED_CAST")
                val out = outputs[0].value as Array<FloatArray>
                val prob = out[0][0]
                if (debug && probSampleCount < PROB_SAMPLE) {
                    probSample[probSampleCount++] = prob
                    if (probSampleCount == PROB_SAMPLE) {
                        // R5-3: the distribution is the evidence - all zeros, a
                        // constant, or a spread tells us which failure it is.
                        log?.invoke(
                            "silero[debug]: first $PROB_SAMPLE probs=" +
                                probSample.joinToString(",") {
                                    String.format(java.util.Locale.US, "%.3f", it)
                                }
                        )
                    }
                }

                // stateN: [2,1,128] → feed back for the next chunk
                @Suppress("UNCHECKED_CAST")
                val stateN = outputs[1].value as Array<Array<FloatArray>>
                var i = 0
                for (d in 0..1) {
                    val row = stateN[d][0]
                    for (v in row) {
                        if (i < STATE_SIZE) state[i++] = v
                    }
                }

                val clamped = prob.coerceIn(0f, 1f)
                if (clamped > maxProb) maxProb = clamped
                probSum += clamped
                return clamped
            }
        } finally {
            inputTensor.close()
            stateTensor.close()
            srTensor.close()
        }
    }

    companion object {
        private const val STATE_SIZE = 2 * 1 * 128
        private const val PROB_SAMPLE = 90
        /** R5-3/Phase-2: dump rms + first 16 samples of the first N chunks. */
        private const val HEAD_SAMPLE_CHUNKS = 10
    }

    /** Mean probability this session (0 before any process()). */
    fun meanProb(): Float = if (processCount > 0) probSum / processCount else 0f
    fun chunkCount(): Int = processCount
}
