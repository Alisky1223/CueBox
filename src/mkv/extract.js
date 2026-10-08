import { Reader, children, readStr, readUint, readVint } from "./ebml.js";
import { cleanAss, splitN } from "../subtitles/parsers.js";

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
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
};
const LEVEL1 = new Set([
  0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367,
]);
const TEXT_CODECS = /^(S_TEXT\/(UTF8|ASCII|SSA|ASS|WEBVTT)|S_SSA|S_ASS)$/;
const SUBTITLE_TRACK = 0x11;
const DEFAULT_CUE_SECONDS = 4;

export function parseTracks(b) {
  const tracks = [];
  for (const e of children(b)) {
    if (e.id !== ID.TrackEntry) continue;
    const t = { language: "eng", isDefault: true };
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

async function decompress(payload, comp) {
  if (!comp) return payload;
  if (comp.algo === 3) {
    const out = new Uint8Array(comp.settings.length + payload.length);
    out.set(comp.settings);
    out.set(payload, comp.settings.length);
    return out;
  }
  if (comp.algo === 0) {
    const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error(`unsupported compression ${comp.algo}`);
}

function toSubtitleTrack(t) {
  const language = t.ietf || t.language;
  return {
    number: t.number,
    label: [t.name, language].filter(Boolean).join(" – ") || `Track ${t.number}`,
    language,
    codec: t.codec,
    isDefault: t.isDefault,
    supported: TEXT_CODECS.test(t.codec),
    compression: t.compression,
  };
}

/**
 * Scans a Matroska/WebM blob for text subtitle tracks and streams their cues.
 * Returns null if the blob is not Matroska.
 *
 * @param {Blob} blob
 * @param {object} [handlers]
 * @param {(tracks: object[]) => void} [handlers.onTracks] subtitle tracks, before any cue
 * @param {(trackNumber: number, cue: {start: number, end: number, text: string}) => void} [handlers.onCue]
 * @param {(fraction: number, cueCount: number) => void} [handlers.onProgress]
 * @param {AbortSignal} [handlers.signal]
 */
export async function extractMkvSubs(blob, { onTracks, onCue, onProgress, signal } = {}) {
  const r = new Reader(blob);
  const ebml = await r.header(0);
  if (ebml.id !== ID.EBML) return null;
  const seg = await r.header(ebml.data + ebml.size);
  if (seg.id !== ID.Segment) return null;
  const segEnd = seg.size < 0 ? blob.size : seg.data + seg.size;

  let scale = 1e6;
  let tracks = [];
  let textTracks = null;
  let cueCount = 0;
  const result = () => ({ tracks, cueCount });

  const handleBlock = async (data, clusterTc, durationTicks) => {
    const tn = readVint(data, 0);
    const track = textTracks.get(tn.value);
    const flags = data[tn.len + 2];
    if (!track || flags & 0x06) return; // laced subtitle blocks are not used in practice
    const rel = ((data[tn.len] << 24) >> 16) | data[tn.len + 1];
    const payload = await decompress(data.subarray(tn.len + 3), track.compression);
    let text = new TextDecoder().decode(payload);
    if (/(SSA|ASS)$/.test(track.codec)) text = cleanAss(splitN(text, ",", 9)[8] || "");
    text = text.trim();
    if (!text) return;
    const start = ((clusterTc + rel) * scale) / 1e9;
    const end = durationTicks != null ? start + (durationTicks * scale) / 1e9 : start + DEFAULT_CUE_SECONDS;
    onCue?.(track.number, { start, end, text });
    cueCount++;
  };

  let pos = seg.data;
  while (pos < segEnd && !signal?.aborted) {
    const h = await r.header(pos);

    if (h.id === ID.Info) {
      for (const c of children(await r.bytes(h.data, h.size))) if (c.id === ID.TimecodeScale) scale = readUint(c.bytes);
    } else if (h.id === ID.Tracks) {
      const all = parseTracks((await r.bytes(h.data, h.size)).slice());
      tracks = all.filter((t) => t.type === SUBTITLE_TRACK).map(toSubtitleTrack);
      textTracks = new Map(tracks.filter((t) => t.supported).map((t) => [t.number, t]));
      onTracks?.(tracks);
      if (!textTracks.size) return result();
    } else if (h.id === ID.Cluster) {
      if (!textTracks) return result();
      const clusterEnd = h.size < 0 ? segEnd : h.data + h.size;
      let p = h.data;
      let clusterTc = 0;
      while (p < clusterEnd) {
        const c = await r.header(p);
        if (h.size < 0 && LEVEL1.has(c.id)) break;
        if (c.id === ID.Timecode) {
          clusterTc = readUint(await r.bytes(c.data, c.size));
        } else if (c.id === ID.SimpleBlock) {
          const tn = readVint(await r.bytes(c.data, 8), 0);
          if (textTracks.has(tn.value)) await handleBlock((await r.bytes(c.data, c.size)).slice(), clusterTc, null);
        } else if (c.id === ID.BlockGroup) {
          // Peek at the leading Block's track number so large video groups are skipped unread.
          const first = await r.header(c.data);
          const tn = first.id === ID.Block ? readVint(await r.bytes(first.data, 8), 0) : null;
          if (!tn || textTracks.has(tn.value)) {
            const group = (await r.bytes(c.data, c.size)).slice();
            let block = null;
            let duration = null;
            for (const g of children(group)) {
              if (g.id === ID.Block) block = g.bytes;
              else if (g.id === ID.BlockDuration) duration = readUint(g.bytes);
            }
            if (block) await handleBlock(block, clusterTc, duration);
          }
        }
        p = c.data + c.size;
      }
      pos = p;
      onProgress?.(pos / blob.size, cueCount);
      continue;
    }

    if (h.size < 0) break;
    pos = h.data + h.size;
  }
  return result();
}
