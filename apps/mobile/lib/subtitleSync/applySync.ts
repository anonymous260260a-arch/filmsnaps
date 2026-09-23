/**
 * Two application paths for subtitle sync:
 * Path A â€” pure offset via native setSubtitleOffset (default).
 * Path B â€” drift correction â†’ subtitle file rewrite.
 */

import { File, Directory, Paths } from "expo-file-system";
import { toNativeOffset } from "./sign";
import { parseSubtitles } from "./parseSubtitles";
import type { Cue, SubFormat } from "./types";

// Lazy import â€” only called on native platforms
let ExpoVideoNativeModule: any;
try {
  ExpoVideoNativeModule = require("expo-video").ExpoVideoNativeModule;
} catch {
  // web/build â€” module not available
}

/**
 * Path A: Apply offset via native setSubtitleOffset.
 * effectiveOffset = autoOffsetMs + manualOffsetMs (caller computes sum).
 */
export async function applyOffset(offsetMs: number): Promise<void> {
  if (!ExpoVideoNativeModule?.setSubtitleOffset) {
    throw new Error("setSubtitleOffset not available");
  }
  ExpoVideoNativeModule.setSubtitleOffset(toNativeOffset(offsetMs));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Path B: Rewrite subtitle file with drift correction
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Shift cues by scale + offset, clamp, and serialize.
 * Returns the rewritten file content.
 */
export function rewriteCues(
  cues: Cue[],
  scale: number,
  offsetSec: number,
  format: SubFormat,
): string {
  const shifted = cues.map((c) => ({
    start: Math.max(0, c.start * scale + offsetSec),
    end: Math.max(0, c.end * scale + offsetSec),
    text: c.text,
  }));

  // Ensure end > start
  for (const c of shifted) {
    if (c.end <= c.start) c.end = c.start + 0.001;
  }

  if (format === "ass" || format === "ssa") {
    return rewriteAss(shifted);
  }
  return rewriteSrt(shifted);
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}

function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(",", ".");
}

function rewriteSrt(cues: Cue[]): string {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}`,
    )
    .join("\n\n");
}

/** ASS/SSA: timestamp-only rewrite â€” regex-replace the two time fields on Dialogue lines, leave styling untouched. */
function rewriteAss(cues: Cue[]): string {
  // For ASS we need the original lines to preserve styling.
  // Since we only have shifted cues without original lines, generate Dialogue lines.
  // This is a simplified rewrite â€” styling is lost. Use the full rewrite path
  // when original ASS text is available.
  const lines: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const start = formatAssTime(c.start);
    const end = formatAssTime(c.end);
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${c.text}`);
  }
  return lines.join("\n");
}

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor(((seconds % 1) * 100) % 100);
  return (
    String(h) +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "." +
    String(cs).padStart(2, "0")
  );
}

export function mimeTypeForFormat(format: SubFormat): string {
  switch (format) {
    case "ass":
    case "ssa":
      return "text/x-ssa";
    case "vtt":
      return "text/vtt";
    default:
      return "application/x-subrip";
  }
}

/**
 * Rewrite a sidecar subtitle file with a pure time offset applied to every
 * cue, returning the new file URI. The native setSubtitleOffset path only
 * shifts EMBEDDED MKV/WebM text tracks - downloaded .srt/.vtt sidecars (the
 * common case) are parsed by media3's subtitle parser and never see that
 * offset, so the only reliable apply for them is to shift the timestamps in
 * the file itself and re-add it as a sidecar.
 */
export async function writeShiftedSubtitleFile(
  cues: Cue[],
  offsetSec: number,
  format: SubFormat,
  sourceUri: string,
): Promise<string | null> {
  try {
    const shifted = rewriteCues(cues, 1, offsetSec, format);
    const base = Paths.cache?.uri ?? Paths.document?.uri ?? "";
    const dirUri = `${base}${base.endsWith("/") ? "" : "/"}subtitles-sync/`;
    const dir = new Directory(dirUri);
    if (!dir.exists) dir.create({ intermediates: true });
    // STABLE name (offset in the name, no timestamp): the persisted subtitle
    // choice keeps pointing at a valid file, re-syncs overwrite in place, and
    // the applied offset can be read back from the name (see appliedOffsetMs).
    const origName = (sourceUri.split("/").pop() ?? "subtitle")
      .replace(/^synced-(-?\d+)-/, "")
      .replace(/^pristine-/, "");
    const ms = Math.round(offsetSec * 1000);
    const dest = new File(dir, `synced-${ms}-${origName}`);
    if (dest.exists) dest.delete();
    dest.create();
    dest.write(shifted);
    return dest.uri;
  } catch {
    return null;
  }
}

/** Subtitle format from a file name (R5-2). Defaults to srt. */
export function formatFromUri(uri: string): SubFormat {
  const ext = (uri.split("?")[0].split(".").pop() ?? "").toLowerCase();
  if (ext === "vtt") return "vtt";
  if (ext === "ass") return "ass";
  if (ext === "ssa") return "ssa";
  if (ext === "sub") return "sub";
  return "srt";
}

/**
 * Pristine (unshifted) source for a sidecar that may already have an offset
 * baked in (R5-2).
 *
 * The manual stepper rewrites the sidecar file, so each press must start from
 * the ORIGINAL timeline - otherwise the shifts stack (the same failure class as
 * the original double-shift bug). A `synced-<ms>-<name>` file is un-shifted by
 * exactly its baked offset and cached next to it as `pristine-<name>`, so this
 * is a one-time cost per file.
 */
export async function ensurePristineSidecar(
  uri: string,
): Promise<{ uri: string; text: string } | null> {
  try {
    const applied = appliedOffsetMs(uri) ?? 0;
    const base = Paths.cache?.uri ?? Paths.document?.uri ?? "";
    const dirUri = `${base}${base.endsWith("/") ? "" : "/"}subtitles-sync/`;
    const dir = new Directory(dirUri);
    if (!dir.exists) dir.create({ intermediates: true });
    if (applied === 0) {
      // Already pristine (names without the synced- prefix).
      return { uri, text: await new File(uri).text() };
    }
    const origName = (uri.split("/").pop() ?? "subtitle").replace(
      /^synced-(-?\d+)-/,
      "",
    );
    const pristine = new File(dir, `pristine-${origName}`);
    if (pristine.exists) {
      return { uri: pristine.uri, text: await pristine.text() };
    }
    const format = formatFromUri(uri);
    const cues = parseSubtitles(await new File(uri).text(), format);
    if (cues.length === 0) return null;
    const unshifted = rewriteCues(cues, 1, -applied / 1000, format);
    pristine.create();
    pristine.write(unshifted);
    return { uri: pristine.uri, text: unshifted };
  } catch {
    return null;
  }
}

/** Offset already baked into a file created by writeShiftedSubtitleFile (ms), else null. */
export function appliedOffsetMs(uri: string | null | undefined): number | null {
  if (!uri) return null;
  const name = uri.split("/").pop() ?? "";
  const m = name.match(/^synced-(-?\d+)-/);
  return m ? Number(m[1]) : null;
}
