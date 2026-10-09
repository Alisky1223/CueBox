import { describe, expect, it } from "vitest";
import { children, readUint } from "../src/mkv/ebml.js";
import { codecName, extractMkvTrack, readMkvAudioTracks } from "../src/mkv/audio.js";
import { ID, readMkvTracks } from "../src/mkv/scan.js";
import { blockGroup, mkv, simpleBlock } from "./helpers/mkv.js";

const VIDEO = { number: 1, type: 0x01, codec: "V_MPEG4/ISO/AVC" };
const ENGLISH = { number: 2, type: 0x02, codec: "A_AAC/MPEG4/LC", name: "Original", language: "eng" };
const PERSIAN = { number: 3, type: 0x02, codec: "A_AC3", language: "per" };

const fixture = (opts = {}) =>
  mkv({
    tracks: [VIDEO, ENGLISH, PERSIAN],
    clusters: [
      {
        timecode: 0,
        blocks: [simpleBlock(1, 0, new Uint8Array(3000)), simpleBlock(2, 0, "en-a"), simpleBlock(3, 0, "fa-a")],
      },
      { timecode: 2000, blocks: [simpleBlock(1, 0, new Uint8Array(3000)), simpleBlock(2, 5, "en-b")] },
      { timecode: 4000, blocks: [blockGroup(3, 10, "fa-b", 20), simpleBlock(1, 0, new Uint8Array(10))] },
    ],
    ...opts,
  });

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

function segmentChildren(b) {
  const [, segment] = [...children(b)];
  expect(segment.id).toBe(ID.Segment);
  return { segment, elements: [...children(b, segment.data, segment.end)] };
}

describe("readMkvAudioTracks", () => {
  it("lists audio tracks in file order with labels and codec names", async () => {
    expect(await readMkvAudioTracks(fixture())).toEqual([
      { number: 2, label: "Original – eng", language: "eng", codec: "AAC", isDefault: true },
      { number: 3, label: "per", language: "per", codec: "AC3", isDefault: true },
    ]);
  });

  it("returns null for non-Matroska data", async () => {
    expect(await readMkvAudioTracks(new Blob([new Uint8Array(64).fill(0x80)]))).toBeNull();
  });
});

describe("codecName", () => {
  it("maps Matroska codec ids to short names", () => {
    expect(codecName("A_AAC/MPEG2/LC/SBR")).toBe("AAC");
    expect(codecName("A_EAC3")).toBe("E-AC3");
    expect(codecName("A_MPEG/L3")).toBe("MP3");
    expect(codecName("A_MS/ACM")).toBe("MS/ACM");
  });
});

describe("extractMkvTrack", () => {
  it("keeps only the chosen track's entry and blocks, unchanged", async () => {
    const out = await extractMkvTrack(fixture(), 3);
    expect((await readMkvTracks(out)).map((t) => t.number)).toEqual([3]);

    const { elements } = segmentChildren(await bytesOf(out));
    const clusters = elements.filter((e) => e.id === ID.Cluster);
    expect(clusters).toHaveLength(2);
    const contents = clusters.map((c) =>
      [...children(c.bytes)].map((e) => (e.id === ID.Timecode ? readUint(e.bytes) : e.id)),
    );
    expect(contents).toEqual([
      [0, ID.SimpleBlock],
      [4000, ID.BlockGroup],
    ]);
    const payload = [...children(clusters[0].bytes)][1].bytes;
    expect(new TextDecoder().decode(payload.subarray(4))).toBe("fa-a");
  });

  it("writes Cues before the clusters that point at each cluster", async () => {
    const b = await bytesOf(await extractMkvTrack(fixture({ unknownSizes: true }), 2));
    const { segment, elements } = segmentChildren(b);
    const order = elements.map((e) => e.id);
    expect(order.indexOf(ID.Cues)).toBeLessThan(order.indexOf(ID.Cluster));

    const cues = elements.find((e) => e.id === ID.Cues);
    const points = [...children(cues.bytes)].map((p) => {
      const [time, positions] = [...children(p.bytes)];
      const [track, position] = [...children(positions.bytes)];
      return { time: readUint(time.bytes), track: readUint(track.bytes), position: readUint(position.bytes) };
    });
    expect(points.map((p) => [p.time, p.track])).toEqual([
      [0, 2],
      [2000, 2],
    ]);
    for (const p of points) {
      const [cluster] = children(b, segment.data + p.position);
      expect(cluster.id).toBe(ID.Cluster);
      expect(readUint([...children(cluster.bytes)][0].bytes)).toBe(p.time);
    }
  });

  it("returns null for a missing track", async () => {
    expect(await extractMkvTrack(fixture(), 9)).toBeNull();
  });

  it("returns null when aborted", async () => {
    const controller = new AbortController();
    const out = await extractMkvTrack(fixture(), 2, { signal: controller.signal, onProgress: () => controller.abort() });
    expect(out).toBeNull();
  });
});
