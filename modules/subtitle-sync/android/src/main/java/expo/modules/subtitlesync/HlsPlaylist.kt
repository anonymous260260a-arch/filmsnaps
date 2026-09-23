package expo.modules.subtitlesync

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URL
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Minimal HLS playlist model + parser for subtitle-scan segment fetching.
 *
 * Covers: master playlists (variant + EXT-X-MEDIA audio renditions), media
 * playlists (EXTINF, BYTERANGE, EXT-X-KEY AES-128 with IV/sequence-number
 * defaults, EXT-X-MAP init segments, EXT-X-DISCONTINUITY runs, live check).
 */
data class HlsSegment(
    val url: String,
    val durationUs: Long,
    val byteOffset: Long,
    val byteLength: Long, // -1 = whole resource
    val mediaSequence: Long,
    val keyMethod: String?,   // null | "NONE" | "AES-128" | "SAMPLE-AES" | ...
    val keyUrl: String?,
    val keyIvHex: String?,
    val discontinuityRun: Int,
)

data class HlsPlaylist(
    val segments: List<HlsSegment>,
    val initUrl: String?,          // EXT-X-MAP init segment (fMP4)
    val initByteOffset: Long,
    val initByteLength: Long,
    val live: Boolean,
    val totalDurationUs: Long,
) {
    val keyMethod: String? get() = segments.firstOrNull { it.keyMethod != null && it.keyMethod != "NONE" }?.keyMethod
}

object HlsPlaylistParser {
    data class KeyInfo(val method: String?, val url: String?, val ivHex: String?)

    /** Returns the media-playlist URL: follows master playlists (prefers
     *  audio-only renditions, else the lowest-bandwidth variant). */
    fun resolveToMedia(playlistUrl: String, headers: Map<String, String>): String {
        var url = playlistUrl
        var hops = 0
        while (hops < 6) {
            val text = fetchText(url, headers)
            val lines = text.split("\n")
            val isMaster = lines.any { it.trimStart().startsWith("#EXT-X-STREAM-INF") }
            if (!isMaster) return url

            // Audio-only renditions first (tiny downloads -> fastest scan).
            val audioUri = lines.firstOrNull {
                it.trimStart().startsWith("#EXT-X-MEDIA") &&
                    it.contains("TYPE=AUDIO", ignoreCase = true)
            }?.let { attrLine ->
                Regex("[,]URI=\"([^\"]+)\"").find(attrLine)?.groupValues?.get(1)
            }
            if (audioUri != null) {
                url = resolveUrl(audioUri, url)
                hops++
                continue
            }

            // Otherwise the lowest-bandwidth video variant.
            var bestBandwidth = Long.MAX_VALUE
            var bestUri: String? = null
            var pendingBw = -1L
            for (raw in lines) {
                val line = raw.trim()
                if (line.startsWith("#EXT-X-STREAM-INF")) {
                    pendingBw = Regex("BANDWIDTH=(\\d+)").find(line)?.groupValues?.get(1)?.toLong() ?: -1L
                } else if (line.isNotEmpty() && !line.startsWith("#")) {
                    if (pendingBw in 0 until bestBandwidth) {
                        bestBandwidth = pendingBw
                        bestUri = line.trim()
                    }
                    pendingBw = -1L
                }
            }
            val chosen = bestUri ?: return url // already a media playlist
            url = resolveUrl(chosen, url)
            hops++
        }
        throw PlaylistProbe.PlaylistError("unsupported-format", "master playlist recursion too deep")
    }

    fun parse(playlistUrl: String, headers: Map<String, String>): HlsPlaylist {
        val text = fetchText(playlistUrl, headers)
        val lines = text.split("\n")

        val segments = ArrayList<HlsSegment>()
        var pendingDurationUs = -1L
        var pendingOffset = -1L
        var pendingLength = -1L
        var pendingDiscontinuity = false
        var currentKey: KeyInfo = KeyInfo("NONE", null, null)
        var initUrl: String? = null
        var initByteOffset = 0L
        var initByteLength = -1L
        var mediaSequence = 0L
        var declaredUs = 0L
        var live = true
        var runIndex = 0
        var sawExtInf = false

        for (raw in lines) {
            val line = raw.trim()
            when {
                line.startsWith("#EXT-X-MEDIA-SEQUENCE") ->
                    mediaSequence = line.substringAfter(":").trim().toLongOrNull() ?: 0L
                line.startsWith("#EXT-X-ENDLIST") -> live = false
                line.startsWith("#EXT-X-DISCONTINUITY") && !line.contains("SEQUENCE") -> {
                    pendingDiscontinuity = true
                    runIndex++
                }
                line.startsWith("#EXT-X-KEY") -> {
                    val method = Regex("METHOD=([^,]+)").find(line)?.groupValues?.get(1)?.trim()
                    val uri = Regex("URI=\"([^\"]+)\"").find(line)?.groupValues?.get(1)
                    val iv = Regex("IV=0[xX]([0-9a-fA-F]+)").find(line)?.groupValues?.get(1)
                    currentKey = KeyInfo(method, uri, iv)
                }
                line.startsWith("#EXT-X-MAP") -> {
                    initUrl = Regex("URI=\"([^\"]+)\"").find(line)?.groupValues?.get(1)?.let { resolveUrl(it, playlistUrl) }
                    val range = Regex("BYTERANGE=\"(\\d+)(?:@(\\d+))?\"").find(line)?.groupValues
                    initByteLength = range?.get(1)?.toLongOrNull() ?: -1L
                    initByteOffset = range?.get(2)?.toLongOrNull() ?: 0L
                }
                line.startsWith("#EXTINF") -> {
                    val d = line.substringAfter(":").substringBefore(",").trim().toDoubleOrNull()
                    if (d != null) {
                        pendingDurationUs = (d * 1_000_000).toLong()
                        sawExtInf = true
                    }
                }
                line.startsWith("#EXT-X-BYTERANGE") -> {
                    val m = Regex("(\\d+)(?:@(\\d+))?").find(line.substringAfter(":"))
                    pendingLength = m?.groupValues?.get(1)?.toLongOrNull() ?: -1L
                    pendingOffset = m?.groupValues?.get(2)?.toLongOrNull() ?: -1L
                }
                line.startsWith("#") || line.isEmpty() -> Unit
                else -> {
                    if (sawExtInf && pendingDurationUs >= 0) {
                        var off = pendingOffset
                        var len = pendingLength
                        if (len > 0 && off < 0) off = declaredUs // legacy byterange chaining unsupported -> full fetch
                        segments.add(
                            HlsSegment(
                                url = resolveUrl(line, playlistUrl),
                                durationUs = pendingDurationUs,
                                byteOffset = off,
                                byteLength = len,
                                mediaSequence = mediaSequence + segments.size,
                                keyMethod = currentKey.method,
                                keyUrl = currentKey.url?.let { resolveUrl(it, playlistUrl) },
                                keyIvHex = currentKey.ivHex,
                                discontinuityRun = runIndex,
                            )
                        )
                        declaredUs += pendingDurationUs
                    }
                    pendingDurationUs = -1L
                    pendingOffset = -1L
                    pendingLength = -1L
                    pendingDiscontinuity = false
                }
            }
        }
        if (segments.isEmpty()) {
            throw PlaylistProbe.PlaylistError("unsupported-format", "media playlist has no segments")
        }
        return HlsPlaylist(segments, initUrl, initByteOffset, initByteLength, live, declaredUs)
    }

    fun resolveUrl(child: String, base: String): String {
        if (child.startsWith("http://") || child.startsWith("https://")) return child
        return try {
            val b = URL(base)
            URL(b, child).toString()
        } catch (e: Exception) {
            child
        }
    }

    private fun fetchText(url: String, headers: Map<String, String>): String {
        val conn = URL(url).openConnection() as java.net.HttpURLConnection
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.requestMethod = "GET"
            headers.forEach(conn::setRequestProperty)
            val code = conn.responseCode
            if (code !in 200..299) {
                throw PlaylistProbe.PlaylistError(
                    if (code == 401 || code == 403 || code == 410) "expired-url" else "network",
                    "HTTP $code fetching playlist",
                )
            }
            conn.inputStream.use { stream ->
                return BufferedReader(InputStreamReader(stream)).use { it.readText() }
            }
        } finally {
            conn.disconnect()
        }
    }

    fun fetchSegment(
        seg: HlsSegment,
        headers: Map<String, String>,
        keyCache: MutableMap<String, ByteArray>,
    ): ByteArray {
        val conn = URL(seg.url).openConnection() as java.net.HttpURLConnection
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 30_000
            conn.requestMethod = "GET"
            headers.forEach(conn::setRequestProperty)
            if (seg.byteLength > 0) {
                val end = seg.byteOffset + seg.byteLength - 1
                conn.setRequestProperty("Range", "bytes=${seg.byteOffset}-$end")
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                throw PlaylistProbe.PlaylistError(
                    if (code == 401 || code == 403 || code == 410) "expired-url" else "network",
                    "HTTP $code fetching segment",
                )
            }
            var data = conn.inputStream.use { it.readBytes() }

            if (seg.keyMethod == "AES-128") {
                val keyUrl = seg.keyUrl ?: throw PlaylistProbe.PlaylistError("unsupported-format", "AES-128 without key URI")
                val key = keyCache.getOrPut(keyUrl) {
                    val kc = URL(keyUrl).openConnection() as java.net.HttpURLConnection
                    try {
                        kc.connectTimeout = 10_000
                        kc.readTimeout = 10_000
                        kc.requestMethod = "GET"
                        headers.forEach(kc::setRequestProperty)
                        if (kc.responseCode !in 200..299) {
                            throw PlaylistProbe.PlaylistError("network", "HTTP ${kc.responseCode} fetching key")
                        }
                        val k = kc.inputStream.use { it.readBytes() }
                        if (k.size != 16) throw PlaylistProbe.PlaylistError("unsupported-format", "bad HLS key length ${k.size}")
                        k
                    } finally {
                        kc.disconnect()
                    }
                }
                val iv = seg.keyIvHex?.let { hexToBytes(it) }
                    ?: seqIv(seg.mediaSequence)
                val cipher = Cipher.getInstance("AES/CBC/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
                // PKCS7 unpad per HLS spec (segments are 16-byte aligned).
                val padded = padToBlock16(data)
                val dec = cipher.doFinal(padded)
                val padLen = dec.last().toInt() and 0xFF
                data = if (padLen in 1..16 && padLen <= dec.size) dec.copyOfRange(0, dec.size - padLen) else dec
            }
            return data
        } finally {
            conn.disconnect()
        }
    }

    private fun seqIv(mediaSequence: Long): ByteArray {
        val iv = ByteArray(16)
        var seq = mediaSequence
        for (i in 15 downTo 0) {
            iv[i] = (seq and 0xFF).toByte()
            seq = seq shr 8
        }
        return iv
    }

    private fun hexToBytes(hex: String): ByteArray {
        val h = if (hex.length % 2 == 1) "0$hex" else hex
        return ByteArray(h.length / 2) { i ->
            ((Character.digit(h[i * 2], 16) shl 4) + Character.digit(h[i * 2 + 1], 16)).toByte()
        }
    }

    private fun padToBlock16(data: ByteArray): ByteArray {
        val rem = data.size % 16
        if (rem == 0) return data
        return data.copyOf(data.size + 16 - rem)
    }
}
