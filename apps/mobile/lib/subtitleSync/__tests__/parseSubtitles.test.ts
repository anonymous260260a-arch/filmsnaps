import { describe, it, expect } from "vitest";
import { parseSubtitles } from "../parseSubtitles";

describe("parseSubtitles", () => {
  // ——— SRT golden ———
  it("parses standard SRT", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:05,000 --> 00:00:07,200
Second cue`;
    const cues = parseSubtitles(srt, "srt");
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(1.0, 2);
    expect(cues[0].end).toBeCloseTo(3.5, 2);
    expect(cues[0].text).toBe("Hello world");
    expect(cues[1].start).toBeCloseTo(5.0, 2);
    expect(cues[1].end).toBeCloseTo(7.2, 2);
  });

  // ——— VTT golden ———
  it("parses VTT with WEBVTT header", () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
Hello world`;
    const cues = parseSubtitles(vtt, "vtt");
    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBeCloseTo(1.0, 2);
    expect(cues[0].end).toBeCloseTo(3.5, 2);
  });

  // ——— VTT without hours ———
  it("parses VTT with short MM:SS.mmm timestamps", () => {
    const vtt = `WEBVTT

00:01.000 --> 00:03.500
Hello world

01:05.250 --> 01:07.000
Second cue`;
    const cues = parseSubtitles(vtt, "vtt");
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(1.0, 2);
    expect(cues[0].end).toBeCloseTo(3.5, 2);
    expect(cues[1].start).toBeCloseTo(65.25, 2);
    expect(cues[1].end).toBeCloseTo(67.0, 2);
  });

  it("parses SRT with short MM:SS,mmm timestamps too (lenient)", () => {
    const srt = `1
00:01,000 --> 00:03,500
Short SRT`;
    const cues = parseSubtitles(srt, "srt");
    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBeCloseTo(1.0, 2);
    expect(cues[0].end).toBeCloseTo(3.5, 2);
  });

  // ——— MicroDVD (.sub) ———
  it("parses MicroDVD frame-based cues", () => {
    // 23.976 fps: frame 0 -> 0s, frame 72 -> ~3.003s
    const sub = `{0}{72}{y:i}Hello world
{240}{360}Second line`;
    const cues = parseSubtitles(sub, "sub");
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(0.0, 2);
    expect(cues[0].end).toBeCloseTo(72 / 23.976, 2);
    expect(cues[1].start).toBeCloseTo(240 / 23.976, 2);
    expect(cues[1].end).toBeCloseTo(360 / 23.976, 2);
  });

  it("strips MicroDVD inline control tags and splits | lines", () => {
    const sub = `{0}{72}{y:i}Hello|world{/y:i}`;
    const cues = parseSubtitles(sub, "sub");
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Hello\nworld");
  });

  // ——— ASS golden ———
  it("parses ASS Dialogue lines", () => {
    const ass = `[Script Info]
Title: Test

[V4+ Styles]
Format: Name,Fontname,Fontsize,...

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:01.50,0:00:04.00,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:06.00,0:00:08.50,Default,,0,0,0,,Second cue`;
    const cues = parseSubtitles(ass, "ass");
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(1.5, 2);
    expect(cues[0].end).toBeCloseTo(4.0, 2);
    expect(cues[1].start).toBeCloseTo(6.0, 2);
    expect(cues[1].end).toBeCloseTo(8.5, 2);
  });

  // ——— BOM handling ———
  it("handles BOM in SRT", () => {
    const srt = "\uFEFF1\n00:00:01,000 --> 00:00:03,500\nBOM test";
    const cues = parseSubtitles(srt, "srt");
    expect(cues).toHaveLength(1);
  });

  // ——— Empty / malformed ———
  it("returns empty for no timecodes", () => {
    expect(
      parseSubtitles("just some text\nno arrows here", "srt"),
    ).toHaveLength(0);
  });

  it("handles CRLF line endings", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:03,500\r\nCRLF test";
    const cues = parseSubtitles(srt, "srt");
    expect(cues).toHaveLength(1);
  });
});
