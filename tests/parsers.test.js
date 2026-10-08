import { describe, expect, it } from "vitest";
import {
  decodeText,
  parseAss,
  parseSrtVtt,
  parseSubtitleFile,
  parseTime,
  toCueText,
} from "../src/subtitles/parsers.js";

describe("parseTime", () => {
  it.each([
    ["00:00:01,500", 1.5],
    ["01:02:03.250", 3723.25],
    ["02:03.5", 123.5],
    ["0:00:05.10", 5.1],
  ])("%s -> %d", (input, expected) => expect(parseTime(input)).toBeCloseTo(expected));
});

describe("parseSrtVtt", () => {
  it("parses SRT with CRLF line endings and multi-line text", () => {
    const srt =
      "1\r\n00:00:01,500 --> 00:00:03,000\r\nLine one\r\nLine two\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,250\r\nNext\r\n";
    expect(parseSrtVtt(srt)).toEqual([
      { start: 1.5, end: 3, text: "Line one\nLine two" },
      { start: 62, end: 64.25, text: "Next" },
    ]);
  });

  it("parses WebVTT, ignoring header, notes and cue settings", () => {
    const vtt = "WEBVTT\n\nNOTE a comment\n\ncue-1\n00:05.000 --> 00:07.500 align:start line:0\nHi\n";
    expect(parseSrtVtt(vtt)).toEqual([{ start: 5, end: 7.5, text: "Hi" }]);
  });

  it("skips cues without text", () => {
    expect(parseSrtVtt("1\n00:00:01,000 --> 00:00:02,000\n\n")).toEqual([]);
  });
});

describe("parseAss", () => {
  it("uses the Format line field order and cleans override tags", () => {
    const ass = String.raw`[Script Info]
Title: test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.10,0:00:07.00,Default,,0,0,0,,{\i1}Hello{\i0}, world\Nline two{\pos(1,2)}
Dialogue: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,{\p1}m 0 0 l 10 10{\p0}`;
    expect(parseAss(ass)).toEqual([{ start: 5.1, end: 7, text: "<i>Hello</i>, world\nline two" }]);
  });
});

describe("parseSubtitleFile", () => {
  it("picks the parser by extension", () => {
    expect(parseSubtitleFile("a.SRT", "1\n00:00:01,000 --> 00:00:02,000\nx")).toHaveLength(1);
    expect(parseSubtitleFile("a.ass", "Dialogue: 0,0:00:01.00,0:00:02.00,D,,0,0,0,,x")).toHaveLength(1);
  });
});

describe("toCueText", () => {
  it("keeps i/b/u, strips other tags and escapes markup", () => {
    expect(toCueText('<font color="red">Hi</font> <i>there</i> & <b>co</b> 1 < 2\r\nok')).toBe(
      "Hi <i>there</i> &amp; <b>co</b> 1 &lt; 2\nok",
    );
  });
});

describe("decodeText", () => {
  it("decodes UTF-8", () => {
    expect(decodeText(new TextEncoder().encode("سلام"))).toBe("سلام");
  });

  it("falls back to Windows-1256 for invalid UTF-8", () => {
    expect(decodeText(Uint8Array.of(0xd3, 0xe1, 0xc7, 0xe3))).toBe("سلام");
  });

  it("detects UTF-16 LE BOM", () => {
    expect(decodeText(Uint8Array.of(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00))).toBe("Hi");
  });
});
