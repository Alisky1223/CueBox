import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractMkvSubs } from "../src/mkv/extract.js";
import { blockGroup, mkv, simpleBlock } from "./helpers/mkv.js";

const VIDEO = { number: 1, type: 0x01, codec: "V_MPEG4/ISO/AVC" };

async function collect(blob, opts = {}) {
  const cues = [];
  let tracks = null;
  const result = await extractMkvSubs(blob, {
    onTracks: (t) => (tracks = t),
    onCue: (number, cue) => cues.push({ number, ...cue }),
    ...opts,
  });
  return { result, tracks, cues };
}

describe("extractMkvSubs", () => {
  it("returns null for non-Matroska data", async () => {
    expect(await extractMkvSubs(new Blob([new Uint8Array(64).fill(0x80)]))).toBeNull();
  });

  it("extracts SRT cues from SimpleBlocks and BlockGroups, skipping video blocks", async () => {
    const blob = mkv({
      tracks: [VIDEO, { number: 2, codec: "S_TEXT/UTF8", name: "English", language: "eng" }],
      clusters: [
        { timecode: 0, blocks: [simpleBlock(1, 0, new Uint8Array(5000)), blockGroup(2, 1500, "Hello", 2000)] },
        { timecode: 10_000, blocks: [simpleBlock(2, 250, "<i>World</i>")] },
      ],
    });
    const { result, tracks, cues } = await collect(blob);

    expect(tracks).toMatchObject([{ number: 2, label: "English – eng", language: "eng", supported: true }]);
    expect(result.cueCount).toBe(2);
    expect(cues[0]).toEqual({ number: 2, start: 1.5, end: 3.5, text: "Hello" });
    expect(cues[1]).toMatchObject({ number: 2, start: 10.25, text: "<i>World</i>" });
    expect(cues[1].end).toBeGreaterThan(cues[1].start);
  });

  it("decodes ASS events with header-stripping compression", async () => {
    const blob = mkv({
      tracks: [
        {
          number: 3,
          codec: "S_TEXT/ASS",
          compression: { algo: 3, settings: "1,0,Default,,0,0,0,," },
        },
      ],
      clusters: [{ timecode: 0, blocks: [blockGroup(3, 0, String.raw`{\i1}Hi{\i0}\Nthere`, 1000)] }],
    });
    const { cues } = await collect(blob);
    expect(cues).toEqual([{ number: 3, start: 0, end: 1, text: "<i>Hi</i>\nthere" }]);
  });

  it("decodes zlib-compressed blocks", async () => {
    const blob = mkv({
      tracks: [{ number: 2, codec: "S_TEXT/UTF8", compression: { algo: 0 } }],
      clusters: [{ timecode: 0, blocks: [blockGroup(2, 0, deflateSync(Buffer.from("سلام")), 1000)] }],
    });
    const { cues } = await collect(blob);
    expect(cues[0].text).toBe("سلام");
  });

  it("reports image subtitles as unsupported without emitting cues", async () => {
    const blob = mkv({
      tracks: [{ number: 2, codec: "S_HDMV/PGS", language: "per" }],
      clusters: [{ timecode: 0, blocks: [simpleBlock(2, 0, new Uint8Array(10))] }],
    });
    const { result, tracks, cues } = await collect(blob);
    expect(tracks).toMatchObject([{ number: 2, supported: false }]);
    expect(cues).toEqual([]);
    expect(result.cueCount).toBe(0);
  });

  it("handles unknown-size segments and clusters", async () => {
    const blob = mkv({
      unknownSizes: true,
      tracks: [{ number: 2, codec: "S_TEXT/UTF8" }],
      clusters: [
        { timecode: 0, blocks: [blockGroup(2, 0, "one", 1000)] },
        { timecode: 5000, blocks: [blockGroup(2, 0, "two", 1000)] },
      ],
    });
    const { cues } = await collect(blob);
    expect(cues.map((c) => [c.start, c.text])).toEqual([
      [0, "one"],
      [5, "two"],
    ]);
  });

  it("stops when aborted", async () => {
    const blob = mkv({
      tracks: [{ number: 2, codec: "S_TEXT/UTF8" }],
      clusters: [
        { timecode: 0, blocks: [blockGroup(2, 0, "one", 1000)] },
        { timecode: 5000, blocks: [blockGroup(2, 0, "two", 1000)] },
      ],
    });
    const controller = new AbortController();
    const { cues } = await collect(blob, { signal: controller.signal, onProgress: () => controller.abort() });
    expect(cues.map((c) => c.text)).toEqual(["one"]);
  });
});
