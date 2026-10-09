import { describe, expect, it } from "vitest";
import { canDecodeHevc, detectVideoCodec, hasHevcFourcc, isHevcCodecId } from "../src/player/video-codec.js";
import { mkv, simpleBlock } from "./helpers/mkv.js";

const ascii = (s) => new TextEncoder().encode(s);

const stsd = (fourcc) => {
  const b = new Uint8Array(32);
  b.set(ascii("stsd"), 4);
  b[15] = 1;
  b[19] = 16;
  b.set(ascii(fourcc), 20);
  return b;
};

const mp4 = (box, { padBefore = 0, padAfter = 0 } = {}) =>
  new Blob([new Uint8Array(padBefore), ascii("\0\0\0\x18ftypisom"), box, new Uint8Array(padAfter)]);

const mkvWith = (codec) =>
  mkv({
    tracks: [
      { number: 1, type: 0x01, codec },
      { number: 2, type: 0x02, codec: "A_AAC" },
    ],
    clusters: [{ timecode: 0, blocks: [simpleBlock(1, 0, "v")] }],
  });

describe("isHevcCodecId", () => {
  it("matches Matroska HEVC codec ids", () => {
    expect(isHevcCodecId("V_MPEGH/ISO/HEVC")).toBe(true);
    expect(isHevcCodecId("V_MPEG4/ISO/AVC")).toBe(false);
    expect(isHevcCodecId(undefined)).toBe(false);
  });
});

describe("hasHevcFourcc", () => {
  it("finds hvc1 and hev1 sample entries", () => {
    expect(hasHevcFourcc(stsd("hvc1"))).toBe(true);
    expect(hasHevcFourcc(stsd("hev1"))).toBe(true);
    expect(hasHevcFourcc(stsd("avc1"))).toBe(false);
  });

  it("ignores a stray fourcc outside stsd", () => {
    expect(hasHevcFourcc(ascii("....hvc1....hev1........"))).toBe(false);
  });
});

describe("detectVideoCodec", () => {
  it("reads the video track codec of MKV files", async () => {
    expect(await detectVideoCodec(mkvWith("V_MPEGH/ISO/HEVC"))).toBe("hevc");
    expect(await detectVideoCodec(mkvWith("V_MPEG4/ISO/AVC"))).toBe(null);
  });

  it("sniffs MP4 moov at the start or end", async () => {
    expect(await detectVideoCodec(mp4(stsd("hvc1")))).toBe("hevc");
    expect(await detectVideoCodec(mp4(stsd("hev1"), { padBefore: 6 * 1024 * 1024 }))).toBe("hevc");
    expect(await detectVideoCodec(mp4(stsd("avc1"), { padAfter: 1000 }))).toBe(null);
  });
});

describe("canDecodeHevc", () => {
  it("uses canPlayType", () => {
    expect(canDecodeHevc({ canPlayType: () => "probably" })).toBe(true);
    expect(canDecodeHevc({ canPlayType: () => "" })).toBe(false);
  });
});
