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
  _meta?: {
    codec: string;
    audio: string;
    source: string;
    isDownloadOnly: boolean;
    isWebReady: boolean;
    sizeBytes?: number;
  };
}

export interface StreamBundle {
  tmdb_id: number;
  imdb_id: string;
  media_type: "movie" | "tv";
  links: StreamLink[];
}
