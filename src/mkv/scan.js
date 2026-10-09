import { Reader, children, readStr, readUint, readVint } from "./ebml.js";

export const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Name: 0x536e,
  Language: 0x22b59c,
  LanguageIETF: 0x22b59d,
  FlagDefault: 0x88,
  ContentEncodings: 0x6d80,
  ContentEncoding: 0x6240,
  ContentCompression: 0x5034,
  ContentCompAlgo: 0x4254,
  ContentCompSettings: 0x4255,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
};
export const TRACK_TYPE = { video: 0x01, audio: 0x02, subtitle: 0x11 };

const LEVEL1 = new Set([
  0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367,
]);

/** Parses the TrackEntry children of a Tracks element. `raw` is the whole TrackEntry element. */
export function parseTracks(b) {
  const tracks = [];
  for (const e of children(b)) {
    if (e.id !== ID.TrackEntry) continue;
    const t = { language: "eng", isDefault: true, raw: b.subarray(e.start, e.end) };
    for (const c of children(e.bytes)) {
      if (c.id === ID.TrackNumber) t.number = readUint(c.bytes);
      else if (c.id === ID.TrackType) t.type = readUint(c.bytes);
      else if (c.id === ID.CodecID) t.codec = readStr(c.bytes);
      else if (c.id === ID.Name) t.name = readStr(c.bytes);
      else if (c.id === ID.Language) t.language = readStr(c.bytes);
      else if (c.id === ID.LanguageIETF) t.ietf = readStr(c.bytes);
      else if (c.id === ID.FlagDefault) t.isDefault = readUint(c.bytes) === 1;
      else if (c.id === ID.ContentEncodings) t.compression = parseCompression(c.bytes);
    }
    tracks.push(t);
  }
  return tracks;
}

function parseCompression(b) {
  for (const enc of children(b)) {
    if (enc.id !== ID.ContentEncoding) continue;
    for (const c of children(enc.bytes)) {
      if (c.id !== ID.ContentCompression) continue;
      const comp = { algo: 0, settings: new Uint8Array(0) };
      for (const s of children(c.bytes)) {
        if (s.id === ID.ContentCompAlgo) comp.algo = readUint(s.bytes);
        else if (s.id === ID.ContentCompSettings) comp.settings = s.bytes.slice();
      }
      return comp;
    }
  }
  return null;
}

/** Reads a whole element; `raw` includes its header, `data` is the payload. Both are owned copies. */
async function readElement(r, pos, h) {
  const raw = (await r.bytes(pos, h.data + h.size - pos)).slice();
  return { raw, data: raw.subarray(h.data - pos) };
}

/**
 * Walks a Matroska/WebM blob: header, Info, Tracks, then the blocks of the tracks `onTracks` asks for.
 * Blocks of other tracks are skipped without being read. Returns false if the blob is not Matroska.
 *
 * @param {Blob} blob
 * @param {object} [handlers]
 * @param {(raw: Uint8Array) => void} [handlers.onHeader] the EBML header element
 * @param {(info: {raw: Uint8Array, data: Uint8Array}) => void} [handlers.onInfo]
 * @param {(tracks: object[]) => Set<number>} [handlers.onTracks] returns the track numbers to read blocks of
 * @param {(block: {id: number, raw: Uint8Array, data: Uint8Array, track: number}, cluster: {timecode: number}) => void | Promise<void>} [handlers.onBlock]
 *   called with a SimpleBlock or BlockGroup; `cluster` is the same object for every block of one cluster
 * @param {(fraction: number) => void} [handlers.onProgress]
 * @param {AbortSignal} [handlers.signal]
 */
export async function scanMkv(blob, { onHeader, onInfo, onTracks, onBlock, onProgress, signal } = {}) {
  const r = new Reader(blob);
  const ebml = await r.header(0);
  if (ebml.id !== ID.EBML) return false;
  const seg = await r.header(ebml.data + ebml.size);
  if (seg.id !== ID.Segment) return false;
  onHeader?.((await r.bytes(0, ebml.data + ebml.size)).slice());
  const segEnd = seg.size < 0 ? blob.size : seg.data + seg.size;

  let wanted = null;
  let pos = seg.data;
  while (pos < segEnd && !signal?.aborted) {
    const h = await r.header(pos);

    if (h.id === ID.Info) {
      onInfo?.(await readElement(r, pos, h));
    } else if (h.id === ID.Tracks) {
      const { data } = await readElement(r, pos, h);
      wanted = onTracks?.(parseTracks(data));
      if (!wanted?.size) return true;
    } else if (h.id === ID.Cluster) {
      if (!wanted) return true;
      const clusterEnd = h.size < 0 ? segEnd : h.data + h.size;
      const cluster = { timecode: 0 };
      let p = h.data;
      while (p < clusterEnd) {
        const c = await r.header(p);
        if (h.size < 0 && LEVEL1.has(c.id)) break;
        if (c.id === ID.Timecode) {
          cluster.timecode = readUint(await r.bytes(c.data, c.size));
        } else if (c.id === ID.SimpleBlock) {
          const tn = readVint(await r.bytes(c.data, 8), 0);
          if (wanted.has(tn.value)) await onBlock?.({ id: c.id, ...(await readElement(r, p, c)), track: tn.value }, cluster);
        } else if (c.id === ID.BlockGroup) {
          // Peek at the leading Block's track number so large video groups are skipped unread.
          const first = await r.header(c.data);
          const peek = first.id === ID.Block ? readVint(await r.bytes(first.data, 8), 0) : null;
          if (!peek || wanted.has(peek.value)) {
            const group = await readElement(r, p, c);
            const block = [...children(group.data)].find((g) => g.id === ID.Block);
            const track = block && readVint(block.bytes, 0).value;
            if (wanted.has(track)) await onBlock?.({ id: c.id, ...group, track }, cluster);
          }
        }
        p = c.data + c.size;
      }
      pos = p;
      onProgress?.(pos / blob.size);
      continue;
    }

    if (h.size < 0) break;
    pos = h.data + h.size;
  }
  return true;
}

/** Reads only the track list of a Matroska blob, or null if it is not Matroska. */
export async function readMkvTracks(blob) {
  let tracks = [];
  const ok = await scanMkv(blob, {
    onTracks(all) {
      tracks = all;
      return new Set();
    },
  });
  return ok ? tracks : null;
}
