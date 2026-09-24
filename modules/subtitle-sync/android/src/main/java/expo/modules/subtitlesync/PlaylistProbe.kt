package expo.modules.subtitlesync

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

data class PlaylistInfo(
    val live: Boolean,
    val drmProtected: Boolean,
    val muxedOnly: Boolean,
)

class PlaylistProbe {
    class PlaylistError(val code: String, message: String) : Exception(message)

    companion object {
        fun probe(
            playlistUrl: String,
            headers: Map<String, String>,
            maxLevels: Int = 8,
            maxChunkDocs: Int = 4,
        ): Result<PlaylistInfo> {
            var url = playlistUrl
            var levels = 0
            while (levels <= maxLevels) {
                levels++
                val r = fetch(url, headers)
                if (r.isFailure) {
                    val err = r.exceptionOrNull() as? PlaylistError
                    val code = if (err?.code == "expired-url" || err?.message?.lowercase()?.contains("expired") == true) {
                        "expired-url"
                    } else {
                        err?.code ?: "network"
                    }
                    return Result.failure(PlaylistError(code, err?.message ?: "probe failed"))
                }
                val text = r.getOrThrow()
                val head = text.substringBefore("\n")
                if (head.contains("#EXT-X-STREAM-INF", ignoreCase = true)) {
                    // Master playlist: pick the first child variant.
                    val child = firstChildLine(text) ?: return Result.failure(
                        PlaylistError("unsupported-format", "no variant in master playlist")
                    )
                    url = resolve(child, url)
                    continue
                }
                if (head.contains("#EXTM3U", ignoreCase = true)) {
                    // Media playlist.
                    val m3u8 = text
                    val chunksCount = countLines(m3u8, startsWith = "#EXTINF") +
                        countLines(m3u8, startsWith = "#EXT-X-BYTERANGE")
                    if (chunksCount == 0) {
                        return Result.failure(PlaylistError("unsupported-format", "media playlist has no chunks"))
                    }
                    val isLive = isLiveMediaPlaylist(m3u8) || chunksCount <= maxChunkDocs
                    val sample = chunksUrls(text).take(maxChunkDocs)
                    val muxedOnly = if (sample.isEmpty()) true else sample.all { isMuxedChunk(it) }
                    return Result.success(
                        PlaylistInfo(live = isLive, drmProtected = false, muxedOnly = muxedOnly)
                    )
                }
                return Result.failure(PlaylistError("unsupported-format", "not an m3u8 playlist"))
            }
            return Result.failure(PlaylistError("network", "too many playlist levels"))
        }

        private fun isLiveMediaPlaylist(m3u8: String): Boolean {
            return m3u8.contains("#EXT-X-ENDLIST", ignoreCase = true).not() &&
                (m3u8.contains("#EXT-X-MEDIA-SEQUENCE", ignoreCase = true) ||
                    m3u8.contains("#EXT-X-PLAYLIST-TYPE:LIVE", ignoreCase = true))
        }

        private fun countLines(m3u8: String, startsWith: String): Int =
            m3u8.lineSequence().count { it.trimStart().startsWith(startsWith, ignoreCase = true) }

        // R7-B: count/collect ANY non-'#', non-empty line that follows an #EXTINF
        // line as a segment — no extension filter (extensionless CDN segment
        // URLs, e.g. way2movies "movie:524", were gate-blocked as unsupported).
        private fun chunksUrls(m3u8: String): List<String> =
            m3u8.lineSequence()
                .map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") }
                .map { it.substringBefore("?") }
                .toList()

        // Conservative muxed heuristic: only a KNOWN audio-only extension means
        // not muxed; extensionless counts as muxed (tight windows are the safe
        // default — these CDNs' extensionless segments are muxed TS in practice).
        private fun isMuxedChunk(url: String): Boolean =
            !(url.contains(".m4a") || url.contains(".aac") || url.contains(".mp3"))

        private fun firstChildLine(m3u8: String): String? =
            m3u8.lineSequence().drop(1).firstOrNull { it.trim().isNotEmpty() && !it.trim().startsWith("#") }

        private fun resolve(child: String, base: String): String {
            val baseUrl = URL(base)
            val basePath = baseUrl.path.substringBeforeLast("/")
            return if (child.startsWith("http")) child
            else if (child.startsWith("/")) baseUrl.protocol + "://" + baseUrl.authority + child
            else baseUrl.protocol + "://" + baseUrl.authority + basePath + "/" + child
        }

        private fun fetch(url: String, headers: Map<String, String>): Result<String> {
            val conn = URL(url).openConnection() as HttpURLConnection
            try {
                conn.connectTimeout = 10_000
                conn.readTimeout = 15_000
                conn.requestMethod = "GET"
                headers.forEach(conn::setRequestProperty)
                val code = conn.responseCode
                if (code !in 200..299) {
                    val body = conn.errorStream?.let {
                        BufferedReader(InputStreamReader(it)).use { r -> r.readText() }
                    } ?: ""
                    return Result.failure(
                        PlaylistError("network", "HTTP $code ${body.take(200)}")
                    )
                }
                conn.inputStream.use { stream ->
                    val text = BufferedReader(InputStreamReader(stream)).use { r -> r.readText() }
                    return Result.success(text)
                }
            } catch (e: Exception) {
                val msg = e.message ?: "probe failed"
                val code = if (msg.lowercase().contains("expired")) "expired-url" else "network"
                return Result.failure(PlaylistError(code, msg))
            } finally {
                conn.disconnect()
            }
        }
    }
}