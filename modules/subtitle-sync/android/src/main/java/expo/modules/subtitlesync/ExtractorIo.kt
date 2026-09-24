package expo.modules.subtitlesync

import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.extractor.DiscardingTrackOutput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import java.io.EOFException

/**
 * TrackOutput that funnels the selected audio track's samples into the
 * [AudioDecoder] with content-time-rebased presentation timestamps, and
 * discards everything else.
 *
 * PTS rebase modes:
 *  - progressive (MKV/MP4/WebM): container timestamps are 0-based content time
 *    -> identity rebase, beginSegment(0) once.
 *  - HLS: per-segment rebase to the playlist timeline (broadcast TS streams
 *    can start at arbitrary PTS) -> beginSegment(declaredSegmentStartUs) per
 *    segment; the segment's first audio sample pins the offset.
 */
class AudioTapOutput(
    private val decoder: AudioDecoder,
) : TrackOutput {
    /** Content-time base for the current segment (HLS). */
    @Volatile var segmentBaseUs = 0L

    /** HLS: rebase to the playlist timeline via the segment's first audio PTS.
     *  Progressive: identity (container PTS are already 0-based content time). */
    private var pinFirstPts = false
    private var firstPtsUs = -1L

    var samplesTapped = 0L
        private set
    var firstTappedPtsUs = -1L
        private set
    var lastTappedPtsUs = -1L
        private set

    fun beginSegment(baseUs: Long, pinFirst: Boolean) {
        segmentBaseUs = baseUs
        pinFirstPts = pinFirst
        firstPtsUs = -1L
    }

    private var buf = ByteArray(64 * 1024)
    private var written = 0

    override fun format(format: Format) {
        decoder.onFormat(format)
    }

    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
        ensureCapacity(length)
        data.readBytes(buf, written, length)
        written += length
    }

    override fun sampleData(
        input: DataReader,
        length: Int,
        allowEndOfInput: Boolean,
        sampleDataPart: Int,
    ): Int {
        ensureCapacity(length)
        var total = 0
        while (total < length) {
            val n = input.read(buf, written + total, length - total)
            if (n == -1) {
                if (allowEndOfInput && total == 0) return -1
                throw EOFException("unexpected EOF in sample data")
            }
            total += n
        }
        written += total
        return total
    }

    override fun sampleMetadata(
        timeUs: Long,
        flags: Int,
        size: Int,
        offset: Int,
        cryptoData: TrackOutput.CryptoData?,
    ) {
        if (cryptoData != null) {
            decoder.fail("drm-unsupported", "encrypted audio track")
            written = 0
            return
        }
        if (firstPtsUs < 0) firstPtsUs = timeUs
        val contentUs = if (pinFirstPts) segmentBaseUs + (timeUs - firstPtsUs) else timeUs
        samplesTapped++
        if (firstTappedPtsUs < 0) firstTappedPtsUs = contentUs
        lastTappedPtsUs = contentUs

        // The sample occupies [written - offset - size, written - offset) of buf.
        val start = written - offset - size
        if (start < 0 || size <= 0) {
            written = 0
            return
        }
        val sample = buf.copyOfRange(start, start + size)
        decoder.queueSample(sample, contentUs, flags)

        // Keep any trailing bytes (they belong to the next sample).
        val tail = offset
        if (tail > 0) System.arraycopy(buf, written - tail, buf, 0, tail)
        written = tail
    }

    fun reset() {
        written = 0
        firstPtsUs = -1L
        samplesTapped = 0
        firstTappedPtsUs = -1
        lastTappedPtsUs = -1
    }

    private fun ensureCapacity(need: Int) {
        if (written + need > buf.size) {
            buf = buf.copyOf(maxOf(buf.size * 2, written + need))
        }
    }
}

/**
 * ExtractorOutput: first audio track -> [AudioTapOutput], everything else
 * (video, subtitle, metadata) -> media3's DiscardingTrackOutput.
 */
class TapExtractorOutput(
    private val decoder: AudioDecoder,
    private val tap: AudioTapOutput,
    private val onSeekMap: (SeekMap) -> Unit = {},
    private val preferredLang: String? = null,
    /** Optional trace sink; the job uses it to log which audio track got claimed. */
    private val onTrace: ((String) -> Unit)? = null,
) : ExtractorOutput {
    val discard = DiscardingTrackOutput()
    var seekMap: SeekMap? = null
        private set

    // Every audio track's format, in discovery order.
    private val audioFormats = LinkedHashMap<Int, Format>()
    private val gates = HashMap<Int, AudioGate>()

    // Currently claimed track: samples from this id go to the tap.
    @Volatile private var claimedId: Int = -1

    override fun track(id: Int, type: Int): TrackOutput {
        return when (type) {
            C.TRACK_TYPE_AUDIO -> gates.getOrPut(id) { AudioGate(id) }
            else -> discard
        }
    }

    override fun endTracks() {}

    override fun seekMap(sm: SeekMap) {
        this.seekMap = sm
        onSeekMap(sm)
    }

    /** 2-letter lowercase language key; "eng" -> "en", "" for unknown. */
    private fun langKey(lang: String?): String = lang?.trim()?.take(2)?.lowercase() ?: ""

    private fun langMatches(f: Format): Boolean {
        val pref = preferredLang?.trim()?.take(2)?.lowercase() ?: return false
        if (pref.length < 2) return false
        val lk = langKey(f.language)
        return lk.startsWith(pref) || pref.startsWith(lk)
    }

    /** Claim priority: language match (0) > DEFAULT flag (1) > discovery (2). */
    private fun claimPriority(id: Int): Int {
        val f = audioFormats[id] ?: return 99
        return when {
            langMatches(f) -> 0
            f.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0 -> 1
            else -> 2
        }
    }

    private fun onAudioFormat(id: Int, format: Format): Boolean {
        val isNew = !audioFormats.containsKey(id)
        if (isNew) {
            audioFormats[id] = format
            onTrace?.invoke(
                "tap: audio track id=$id mime=${format.sampleMimeType} lang=${format.language ?: "-"} " +
                    "ch=${format.channelCount} def=${format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0} " +
                    "(pref=${preferredLang ?: "-"})",
            )
        }
        if (claimedId == -1) {
            claimedId = id
            onTrace?.invoke("tap: CLAIM id=$id (first seen)")
            return true
        }
        if (id == claimedId) return true
        // Upgrade the claim while no samples have flowed yet: prefer the
        // subtitle-language-matched track, then DEFAULT, then first-seen.
        if (tap.samplesTapped == 0L && isNew && claimPriority(id) < claimPriority(claimedId)) {
            val old = claimedId
            claimedId = id
            tap.reset()
            onTrace?.invoke(
                "tap: CLAIM id=$id lang=${format.language ?: "-"} (upgrade from id=$old " +
                    "p${claimPriority(id)}<p${claimPriority(old)})",
            )
            return true
        }
        onTrace?.invoke(
            "tap: keeping claimed id=$claimedId (id=$id lang=${format.language ?: "-"} " +
                "p${claimPriority(id)} not better than p${claimPriority(claimedId)})",
        )
        return false
    }

    /** Audio track ids in claim-priority order (language match first). */
    fun audioCandidates(): List<Int> =
        audioFormats.keys.sortedWith(compareBy({ claimPriority(it) }, { it }))

    /** Human-readable one-line summary of every audio track seen. */
    fun trackSummary(): String = audioFormats.entries.joinToString(" ") { (id, f) ->
        "[id=$id ${f.sampleMimeType} lang=${f.language ?: "-"} " +
            "d=${f.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0}]"
    }

    /** Id of the track currently feeding the decoder (-1 = none yet). */
    val currentClaimId: Int get() = claimedId

    /** Lowest id among the tracks that match [preferredLang], or null. */
    fun preferredCandidate(): Int? =
        audioFormats.keys.filter { langMatches(audioFormats.getValue(it)) }.minOrNull()

    /** One-line description of the track currently feeding the decoder. */
    fun claimedSummary(): String {
        val id = claimedId
        val f = audioFormats[id]
        return if (f == null) "id=$id (no format)" else
            "id=$id mime=${f.sampleMimeType} lang=${f.language ?: "-"}"
    }

    /** Route [id]'s samples into the decoder from now on (track retry). */
    fun claim(id: Int) {
        if (claimedId == id) return
        claimedId = id
        audioFormats[id]?.let { tap.format(it) }
    }

    /** The recorded format of an audio track (for diagnostics / re-claim). */
    fun formatOf(id: Int): Format? = audioFormats[id]

    private inner class AudioGate(private val id: Int) : TrackOutput {
        private val mine: Boolean get() = claimedId == id

        override fun format(format: Format) {
            if (onAudioFormat(id, format) && mine) {
                tap.format(format)
            }
        }

        override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
            if (mine) tap.sampleData(data, length, sampleDataPart)
            else discard.sampleData(data, length, sampleDataPart)
        }

        override fun sampleData(
            input: DataReader,
            length: Int,
            allowEndOfInput: Boolean,
            sampleDataPart: Int,
        ): Int {
            return if (mine) {
                tap.sampleData(input, length, allowEndOfInput, sampleDataPart)
            } else {
                discard.sampleData(input, length, allowEndOfInput, sampleDataPart)
            }
        }

        override fun sampleMetadata(
            timeUs: Long,
            flags: Int,
            size: Int,
            offset: Int,
            cryptoData: TrackOutput.CryptoData?,
        ) {
            if (mine) {
                tap.sampleMetadata(timeUs, flags, size, offset, cryptoData)
            } else {
                discard.sampleMetadata(timeUs, flags, size, offset, cryptoData)
            }
        }
    }
}