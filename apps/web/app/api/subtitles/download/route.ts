/**
 * Subtitles download API — server-side subtitle file fetcher for the WEB
 * (movi) player.
 *
 * GET /api/subtitles/download?url=<subtitle-file-url>&format=<srt|vtt|ass|ssa|sub>
 *
 * The subtitle providers (Subdl → dl.subdl.com, Wyzie → sub.wyzie.io) send no
 * CORS headers, so the browser cannot fetch the file itself — mpv gets around
 * this by downloading in the Electron main process, but movi parses subtitle
 * files in the page. This proxy fetches server-side and returns the decoded
 * text as `{ content, format }`.
 *
 * movi's parser only understands srt / vtt / ttml, while providers commonly
 * serve ass/ssa — those are converted to SRT here (Dialogue lines → numbered
 * blocks, override tags stripped). `sub` (MicroDVD) has no faithful mapping →
 * HTTP 415, the sheet shows its normal "try another one" error.
 *
 * URL allowlist matches the /api/subtitles search route's provider bases —
 * an open fetch proxy would be an SSRF door.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { desktopSkip } from "../../desktop-skip";

export const revalidate = 1;

const MAX_BYTES = 5 * 1024 * 1024; // subtitle files are KBs; 5MB is generous
const FETCH_TIMEOUT_MS = 15_000;

// Provider file hosts — dl.subdl.com serves Subdl's files, sub.wyzie.io
// (and subdomains) serve Wyzie's. Suffix match so CDN subdomains resolve.
const ALLOWED_HOST_SUFFIXES = ["subdl.com", "wyzie.io"];

/** `H:MM:SS.CC` (ASS) → `HH:MM:SS,mmm` (SRT). */
function assTimeToSrt(raw: string): string | null {
  const m = /(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(raw.trim());
  if (!m) return null;
  const [, h, min, s, frac] = m;
  const ms = frac.padEnd(3, "0").slice(0, 3);
  return `${h.padStart(2, "0")}:${min.padStart(2, "0")}:${s.padStart(2, "0")},${ms}`;
}

/**
 * Minimal ASS/SSA → SRT. Reads [Events] Dialogue lines only; style/geometry
 * markup is dropped (override blocks, \N newlines, \h hard spaces survive as
 * plain text).
 */
function assToSrt(content: string): string {
  const blocks: string[] = [];
  let index = 1;
  for (const line of content.split(/\r?\n/)) {
    if (!/^Dialogue:/i.test(line)) continue;
    // Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    // Text itself may contain commas — everything after field 9 is the text.
    const parts = line.split(":").slice(1).join(":").split(",");
    if (parts.length < 10) continue;
    const start = assTimeToSrt(parts[1]);
    const end = assTimeToSrt(parts[2]);
    const text = parts
      .slice(9)
      .join(",")
      .replace(/\{[^}]*\}/g, "") // override blocks {\an8}, {\i1}…
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ")
      .trim();
    if (!start || !end || !text) continue;
    blocks.push(`${index++}\n${start} --> ${end}\n${text}\n`);
  }
  return blocks.join("\n");
}

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(req: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;
  const origin = req.headers.get("origin");

  const respond = (data: unknown, status = 200) =>
    NextResponse.json(data, {
      status,
      headers: {
        "Cache-Control": "public, max-age=86400",
        ...getCorsHeaders(origin),
      },
    });

  const rawUrl = req.nextUrl.searchParams.get("url");
  const format = (req.nextUrl.searchParams.get("format") ?? "").toLowerCase();
  if (!rawUrl) {
    return respond({ error: "url is required" }, 400);
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return respond({ error: "url is not a valid URL" }, 400);
  }
  if (target.protocol !== "https:") {
    return respond({ error: "only https subtitle URLs are allowed" }, 400);
  }
  if (
    !ALLOWED_HOST_SUFFIXES.some(
      (suffix) =>
        target.hostname === suffix || target.hostname.endsWith(`.${suffix}`),
    )
  ) {
    return respond({ error: "host is not a subtitle provider" }, 403);
  }

  let res: Response;
  try {
    res = await fetch(target.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "FilmSnaps/2.5 (+subtitle-download)" },
    });
  } catch {
    return respond({ error: "subtitle host unreachable" }, 502);
  }
  if (!res.ok) {
    return respond(
      { error: `subtitle host returned HTTP ${res.status}` },
      res.status === 404 ? 404 : 502,
    );
  }

  const text = (await res.text()).slice(0, MAX_BYTES);
  const sourceFormat =
    format ||
    (target.pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? "srt").toLowerCase();

  if (sourceFormat === "sub") {
    return respond(
      { error: "MicroDVD subtitles are not supported in the web player" },
      415,
    );
  }
  if (sourceFormat === "ass" || sourceFormat === "ssa") {
    const srt = assToSrt(text);
    if (!srt.trim()) {
      return respond({ error: "no Dialogue lines found in the subtitle" }, 422);
    }
    return respond({ content: srt, format: "srt" });
  }

  return respond({
    content: text,
    format: sourceFormat === "vtt" ? "vtt" : "srt",
  });
}
