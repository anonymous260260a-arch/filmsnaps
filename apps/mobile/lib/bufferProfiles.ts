/**
 * Buffer Profiles & Format Detection for expo-video / ExoPlayer.
 *
 * Provides container- and codec-specific buffer profiles to balance
 * fast time-to-first-frame with sufficient decode and seek headroom
 * across MP4, MKV, WebM, MPEG-TS, H.264, HEVC, and VP9 streams.
 */

export type ContainerProfile = "mp4" | "mkv" | "webm" | "mpegts" | "unknown";

export interface BufferProfile {
  preferredForwardBufferDuration: number;
  minBufferForPlayback: number;
  minBufferForPlaybackAfterRebuffer: number;
  prioritizeTimeOverSizeThreshold: boolean;
}

export const BUFFER_PROFILES: Record<string, BufferProfile> = {
  "mp4-h264": {
    preferredForwardBufferDuration: 45,
    minBufferForPlayback: 2.5,
    minBufferForPlaybackAfterRebuffer: 2.5,
    prioritizeTimeOverSizeThreshold: true,
  },
  "mp4-hevc": {
    preferredForwardBufferDuration: 45,
    minBufferForPlayback: 2.5,
    minBufferForPlaybackAfterRebuffer: 3.0,
    prioritizeTimeOverSizeThreshold: true,
  },
  "mkv-hevc": {
    preferredForwardBufferDuration: 50,
    minBufferForPlayback: 2.5,
    minBufferForPlaybackAfterRebuffer: 3.0,
    prioritizeTimeOverSizeThreshold: true,
  },
  "mkv-h264": {
    preferredForwardBufferDuration: 45,
    minBufferForPlayback: 2.5,
    minBufferForPlaybackAfterRebuffer: 2.5,
    prioritizeTimeOverSizeThreshold: true,
  },
  mpegts: {
    preferredForwardBufferDuration: 45,
    minBufferForPlayback: 2.5,
    minBufferForPlaybackAfterRebuffer: 3.0,
    prioritizeTimeOverSizeThreshold: true,
  },
  "webm-vp9": {
    preferredForwardBufferDuration: 45,
    minBufferForPlayback: 2.5,
    minBufferForPlaybackAfterRebuffer: 2.5,
    prioritizeTimeOverSizeThreshold: true,
  },
  "webm-vp8": {
    preferredForwardBufferDuration: 40,
    minBufferForPlayback: 2.0,
    minBufferForPlaybackAfterRebuffer: 2.0,
    prioritizeTimeOverSizeThreshold: true,
  },
  "webm-av1": {
    preferredForwardBufferDuration: 50,
    minBufferForPlayback: 2.5,
    minBufferForPlaybackAfterRebuffer: 3.5,
    prioritizeTimeOverSizeThreshold: true,
  },
  default: {
    preferredForwardBufferDuration: 45,
    minBufferForPlayback: 2.5,
    minBufferForPlaybackAfterRebuffer: 2.5,
    prioritizeTimeOverSizeThreshold: true,
  },
};

export function detectContainer(name: string, url: string): ContainerProfile {
  const s = `${name} ${url}`.toLowerCase();
  if (/\.mkv\b|matroska/i.test(s)) return "mkv";
  if (/\.webm\b/i.test(s)) return "webm";
  if (/\.ts\b|mpegts|\.m2ts\b/i.test(s)) return "mpegts";
  if (/\.mp4\b|\.m4v\b/i.test(s)) return "mp4";
  return "unknown";
}

export function detectCodec(
  name: string,
  url: string,
  meta?: { codec?: string },
): string {
  if (meta?.codec) return meta.codec.toLowerCase();
  const s = `${name} ${url}`.toLowerCase();
  if (/hevc|x265|h\.?265/i.test(s)) return "hevc";
  if (/vp9/i.test(s)) return "vp9";
  if (/vp8/i.test(s)) return "vp8";
  if (/av1|av01/i.test(s)) return "av1";
  if (/x264|h\.?264|avc/i.test(s)) return "h264";
  return "unknown";
}

export function getBufferProfile(
  container: ContainerProfile,
  codec: string,
): BufferProfile {
  const key = `${container}-${codec}`;
  return (
    BUFFER_PROFILES[key] ??
    BUFFER_PROFILES[container] ??
    BUFFER_PROFILES.default
  );
}
