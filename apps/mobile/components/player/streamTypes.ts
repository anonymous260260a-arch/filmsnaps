/**
 * Stream types — shared between watch page and HevcPlayer.
 *
 * Matches the response shape from /api/player/direct (and future endpoints).
 */

export interface StreamLink {
  /** Quality label, e.g. "1080p", "4K [Web]" */
  quality: string;
  /** Descriptive name (codec, audio info) */
  name: string;
  /** Index-based ID */
  id: string;
  /** Human-readable file size */
  size?: string;
  /** Direct video URL */
  url: string;
  /** "mp4" | "mkv" | "webm" */
  type: string;
  /** Headers the upstream requires for playback (e.g. Referer). */
  headers?: Record<string, string>;
  _meta?: {
    codec: string;
    audio: string;
    /** Spoken language when the upstream states one (moviebox 🎧 line). */
    audioLanguage?: string;
    source: string;
    isDownloadOnly: boolean;
    isWebReady: boolean;
    sizeBytes?: number;
    providerId?: string;
    /**
     * Sidecar subtitles for this stream. `default === true` flags the track
     * the upstream calls "captions" — the player auto-attaches it (default
     * subtitles ON for anime). Absent `default` = optional track only.
     */
    subtitles?: { lang: string; url: string; default?: boolean }[];
    /**
     * Upstream skip segments as [start, end] seconds (JustAnime per-episode
     * `intro` / `outro`). Players prefer these over locally-detected introdb
     * segments for the title.
     */
    intro?: [number, number] | null;
    outro?: [number, number] | null;
  };
}

export interface StreamBundle {
  tmdb_id: number;
  imdb_id: string;
  media_type: "movie" | "tv";
  links: StreamLink[];
}
