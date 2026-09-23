import Foundation

struct PlaylistInfo {
    let live: Bool
    let drmProtected: Bool
    let muxedOnly: Bool
}

struct PlaylistError: Error {
    let code: String
    let message: String
}

/// Inspects an m3u8 list URL without decoding:
/// follows master→media, flags live/unchunked playlists, and classifies chunk
/// containers (muxed mp4/m4a vs separate-program TS/m4s) for scan-window tuning.
enum PlaylistProbe {
    static let maxLevels = 8
    static let maxChunkDocs = 4

    static func probe(
        playlistUrl: String,
        headers: [String: String],
        completion: @escaping (Result<PlaylistInfo, PlaylistError>) -> Void
    ) {
        var levels = 0
        probeLevel(playlistUrl, headers: headers, levels: &levels, completion: completion)
    }

    private static func probeLevel(
        _ url: String,
        headers: [String: String],
        levels: inout Int,
        completion: @escaping (Result<PlaylistInfo, PlaylistError>) -> Void
    ) {
        levels += 1
        if levels > maxLevels {
            completion(.failure(PlaylistError(code: "network", message: "too many playlist levels")))
            return
        }
        fetch(url, headers: headers) { result in
            switch result {
            case .failure(let err):
                completion(.failure(err))
            case .success(let text):
                guard let head = text.components(separatedBy: "\n").first else {
                    completion(.failure(PlaylistError(code: "unsupported-format", message: "empty playlist")))
                    return
                }
                if head.range(of: "#EXT-X-STREAM-INF", options: .caseInsensitive) != nil {
                    // Master playlist → descend to the first child variant.
                    guard let child = firstChildLine(text) else {
                        completion(.failure(PlaylistError(code: "unsupported-format", message: "no variant in master playlist")))
                        return
                    }
                    probeLevel(resolve(child, base: url), headers: headers, levels: &levels, completion: completion)
                } else if head.range(of: "#EXTM3U", options: .caseInsensitive) != nil {
                    // Media playlist.
                    let chunksCount = countLines(text, startsWith: "#EXTINF")
                        + countLines(text, startsWith: "#EXT-X-BYTERANGE")
                    if chunksCount == 0 {
                        completion(.failure(PlaylistError(code: "unsupported-format", message: "media playlist has no chunks")))
                        return
                    }
                    let isLive = isLiveMediaPlaylist(text) || chunksCount <= maxChunkDocs
                    let sample = chunksUrls(text).prefix(maxChunkDocs)
                    let muxedOnly = sample.isEmpty ? true : sample.allSatisfy { isMuxedChunk($0) }
                    completion(.success(PlaylistInfo(live: isLive, drmProtected: false, muxedOnly: muxedOnly)))
                } else {
                    completion(.failure(PlaylistError(code: "unsupported-format", message: "not an m3u8 playlist")))
                }
            }
        }
    }

    private static func isLiveMediaPlaylist(_ m3u8: String) -> Bool {
        m3u8.range(of: "#EXT-X-ENDLIST", options: .caseInsensitive) == nil &&
            (m3u8.contains("#EXT-X-MEDIA-SEQUENCE") ||
                m3u8.range(of: "#EXT-X-PLAYLIST-TYPE:LIVE", options: .caseInsensitive) != nil)
    }

    private static func countLines(_ m3u8: String, startsWith prefix: String) -> Int {
        m3u8.components(separatedBy: "\n").filter {
            $0.trimmingCharacters(in: .whitespaces).range(of: prefix, options: .caseInsensitive) != nil
        }.count
    }

    private static func chunksUrls(_ m3u8: String) -> [String] {
        m3u8.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .map { $0.components(separatedBy: "?")[0] }
            .filter { $0.contains(".mp4") || $0.contains(".m4a") || $0.contains(".m4s") || $0.contains(".ts") }
    }

    private static func isMuxedChunk(_ url: String) -> Bool {
        url.contains(".mp4") || url.contains(".m4a")
    }

    private static func firstChildLine(_ m3u8: String) -> String? {
        let lines = m3u8.components(separatedBy: "\n").dropFirst()
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty && !trimmed.hasPrefix("#") { return trimmed }
        }
        return nil
    }

    /// Resolve a relative child chunk/variant URL against the playlist URL.
    private static func resolve(_ child: String, base: String) -> String {
        if child.hasPrefix("http") { return child }
        guard let baseUrl = URL(string: base), let baseScheme = baseUrl.scheme, let baseHost = baseUrl.host else {
            return child
        }
        if child.hasPrefix("/") {
            return "\(baseScheme)://\(baseHost)\(child)"
        }
        let basePath = (baseUrl.path as NSString).deletingLastPathComponent
        return "\(baseScheme)://\(baseHost)\(basePath)/\(child)"
    }

    private static func fetch(
        _ url: String,
        headers: [String: String],
        completion: @escaping (Result<String, PlaylistError>) -> Void
    ) {
        guard let u = URL(string: url) else {
            completion(.failure(PlaylistError(code: "unsupported-format", message: "invalid url")))
            return
        }
        var req = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.httpMethod = "GET"
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        URLSession.shared.dataTask(with: req) { data, response, error in
            if let error = error {
                let msg = error.localizedDescription.lowercased()
                let code = msg.contains("403") || msg.contains("401") || msg.contains("410") || msg.contains("expired")
                    ? "expired-url" : "network"
                completion(.failure(PlaylistError(code: code, message: msg)))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failure(PlaylistError(code: "network", message: "no http response")))
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                completion(.failure(PlaylistError(
                    code: "network",
                    message: "HTTP \(http.statusCode)"
                )))
                return
            }
            guard let data else {
                completion(.failure(PlaylistError(code: "network", message: "empty response")))
                return
            }
            if let text = String(data: data, encoding: .utf8) {
                completion(.success(text))
            } else if let text = String(data: data, encoding: .isoLatin1) {
                completion(.success(text))
            } else {
                completion(.failure(PlaylistError(code: "unsupported-format", message: "non-text playlist")))
            }
        }.resume()
    }
}