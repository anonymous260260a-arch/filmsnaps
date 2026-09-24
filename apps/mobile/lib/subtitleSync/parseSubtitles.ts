/**
 * Subtitle parsers - SRT, VTT (incl. MM:SS.mmm), ASS/SSA, MicroDVD.
 * Pure TypeScript, no dependencies.
 */

import type { SubFormat, Cue } from "./types";

const SRT_TIME =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const VTT_SHORT_TIME =
  /(?:^|\s)(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const ASS_TIME =
  /Dialogue:\s*\d+,(\d+):(\d{2}):(\d{2})\.(\d{2}),(\d+):(\d{2}):(\d{2})\.(\d{2}),/;
const MICRODVD_LINE = /^\{\d+\}\{\d+\}/;
/** MicroDVD default frame rate (most files assume 23.976). */
const MICRODVD_FPS = 23.976;

function hms(
  h: string,
  m: string,
  s: string,
  frac: string,
  fracLen: number,
): number {
  return +h * 3600 + +m * 60 + +s + +frac / Math.pow(10, fracLen);
}

function msToSec(m: string, s: string, frac: string, fracLen: number): number {
  return +m * 60 + +s + +frac / Math.pow(10, fracLen);
}

export function parseSubtitles(text: string, format: SubFormat): Cue[] {
  const clean = text.replace(/\r/g, "");

  if (format === "ass" || format === "ssa") {
    return clean.split("\n").flatMap((line) => {
      const m = line.match(ASS_TIME);
      if (!m) return [];
      return [
        {
          start: hms(m[1], m[2], m[3], m[4], 2),
          end: hms(m[5], m[6], m[7], m[8], 2),
          text: "",
        },
      ];
    });
  }

  if (format === "sub") {
    return parseMicroDVD(clean);
  }

  // SRT / VTT - block-based. VTT cues may use short MM:SS.mmm timestamps.
  return clean.split(/\n\n+/).flatMap((block) => {
    const lines = block.split("\n");
    const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIdx < 0) return [];
    const timeLine = lines[timeLineIdx];
    const m = timeLine.match(SRT_TIME);
    if (m) {
      return [
        {
          start: hms(m[1], m[2], m[3], m[4], m[4].length),
          end: hms(m[5], m[6], m[7], m[8], m[8].length),
          text: lines.slice(timeLineIdx + 1).join("\n"),
        },
      ];
    }
    const v = timeLine.match(VTT_SHORT_TIME);
    if (v) {
      return [
        {
          start: msToSec(v[1], v[2], v[3], v[3].length),
          end: msToSec(v[4], v[5], v[6], v[6].length),
          text: lines.slice(timeLineIdx + 1).join("\n"),
        },
      ];
    }
    return [];
  });
}

/** MicroDVD: "{startFrame}{endFrame}Text" (possibly | separated lines). */
function parseMicroDVD(clean: string): Cue[] {
  const cues: Cue[] = [];
  for (const line of clean.split("\n")) {
    if (!MICRODVD_LINE.test(line)) continue;
    const m = line.match(/^\{(\d+)\}\{(\d+)\}(.*)$/);
    if (!m) continue;
    cues.push({
      start: +m[1] / MICRODVD_FPS,
      end: +m[2] / MICRODVD_FPS,
      text: m[3].replace(/\|/g, "\n").replace(/\{[^}]*\}/g, ""),
    });
  }
  return cues;
}
