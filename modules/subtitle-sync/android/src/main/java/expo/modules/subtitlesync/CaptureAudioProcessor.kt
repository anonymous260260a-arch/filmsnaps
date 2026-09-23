package expo.modules.subtitlesync

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Last stage of the silent HLS audio sink: tees decoded PCM into a
 * [SignalAccumulator] (VAD speech -> 100Hz bins) and passes the audio through
 * untouched so the player keeps seeing normal audio (then mutes at sink level).
 *
 * It is a transparent pass-through - accepts any encoding the decoder emits
 * (float / 16-bit / 24-bit / 32-bit linear PCM); binning decodes the formats
 * we can, anything else (u-law, passthrough-compressed) passes through and is
 * simply not binned.
 *
 * The tap sits in the audio-processor chain BEFORE media3's speed processor
 * (DefaultAudioProcessorChain = [user processors..., silenceSkipping, sonic]),
 * so `pushMono` receives original-content-rate samples regardless of playback
 * speed - bin math needs no /speed adjustment.
 *
 * queueInput copies through an intermediate byte array: media3's buffer pool
 * can hand us the SAME buffer as output, and a ByteBuffer put(ByteBuffer)
 * into itself throws "The source buffer is this buffer"
 * (IllegalArgumentException - observed on moto g stylus 5G). One array copy
 * per buffer is negligible next to decode cost.
 */
@UnstableApi
class CaptureAudioProcessor(
    private val accumulator: SignalAccumulator,
    private val onPcm: ((first: Boolean) -> Unit)? = null,
) : BaseAudioProcessor() {
    private var firstPcm = true
    private var copyBuf: ByteArray = ByteArray(0)

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        accumulator.resetSourceRate(inputAudioFormat.sampleRate)
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val remaining = inputBuffer.remaining()
        if (remaining == 0) {
            replaceOutputBuffer(0).flip()
            return
        }
        val encoding = inputAudioFormat!!.encoding
        val channels = inputAudioFormat!!.channelCount
        val mono = when (encoding) {
            C.ENCODING_PCM_FLOAT -> monoFromFloat(inputBuffer.duplicate(), channels)
            C.ENCODING_PCM_16BIT -> monoFrom16Bit(inputBuffer.duplicate(), channels)
            C.ENCODING_PCM_24BIT -> monoFrom24Bit(inputBuffer.duplicate(), channels)
            C.ENCODING_PCM_32BIT -> monoFrom32Bit(inputBuffer.duplicate(), channels)
            else -> null
        }
        if (mono != null && mono.isNotEmpty()) {
            accumulator.pushMono(mono)
            onPcm?.invoke(firstPcm)
            firstPcm = false
        }
        // Copy via an array: if output buffer == input buffer (pool aliasing),
        // a direct put() would be a self-put and throw.
        if (copyBuf.size < remaining) copyBuf = ByteArray(remaining)
        inputBuffer.duplicate().get(copyBuf, 0, remaining)
        replaceOutputBuffer(remaining).put(copyBuf, 0, remaining).flip()
    }

    private fun monoFrom16Bit(buffer: ByteBuffer, channels: Int): FloatArray? {
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val shorts = ShortArray(buffer.remaining() / 2)
        buffer.asShortBuffer().get(shorts)
        val frames = shorts.size / channels
        val mono = FloatArray(frames)
        for (i in 0 until frames) {
            var s = 0f
            for (c in 0 until channels) s += shorts[i * channels + c] / 32768f
            mono[i] = s / channels
        }
        return mono
    }

    private fun monoFromFloat(buffer: ByteBuffer, channels: Int): FloatArray? {
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val floats = FloatArray(buffer.remaining() / 4)
        buffer.asFloatBuffer().get(floats)
        val frames = floats.size / channels
        val mono = FloatArray(frames)
        for (i in 0 until frames) {
            var s = 0f
            for (c in 0 until channels) s += floats[i * channels + c]
            mono[i] = (s / channels).coerceIn(-1f, 1f)
        }
        return mono
    }

    private fun monoFrom24Bit(buffer: ByteBuffer, channels: Int): FloatArray? {
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val nBytes = buffer.remaining()
        val frames = nBytes / 3 / channels
        val mono = FloatArray(frames)
        val arr = ByteArray(nBytes)
        buffer.get(arr)
        for (i in 0 until frames) {
            var s = 0
            for (c in 0 until channels) {
                var v = (arr[(i * channels + c) * 3].toInt() and 0xFF) or
                    ((arr[(i * channels + c) * 3 + 1].toInt() and 0xFF) shl 8) or
                    ((arr[(i * channels + c) * 3 + 2].toInt() and 0xFF) shl 16)
                if (v and 0x800000 != 0) v = v or 0xFF000000.toInt()
                s += v
            }
            mono[i] = (s / 8_388_608f) / channels
        }
        return mono
    }

    private fun monoFrom32Bit(buffer: ByteBuffer, channels: Int): FloatArray? {
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val ints = IntArray(buffer.remaining() / 4)
        buffer.asIntBuffer().get(ints)
        val frames = ints.size / channels
        val mono = FloatArray(frames)
        for (i in 0 until frames) {
            var s = 0L
            for (c in 0 until channels) s += ints[i * channels + c]
            mono[i] = (s / 2147483647f) / channels
        }
        return mono
    }
}
