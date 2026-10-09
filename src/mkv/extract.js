import { children, readUint, readVint } from "./ebml.js";
import { ID, TRACK_TYPE, scanMkv } from "./scan.js";
import { cleanAss, splitN } from "../subtitles/parsers.js";

const TEXT_CODECS = /^(S_TEXT\/(UTF8|ASCII|SSA|ASS|WEBVTT)|S_SSA|S_ASS)$/;
const DEFAULT_CUE_SECONDS = 4;

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
  let scale = 1e6;
  let tracks = [];
  let textTracks = null;
  let cueCount = 0;

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

  const isMkv = await scanMkv(blob, {
    signal,
    onInfo({ data }) {
      for (const c of children(data)) if (c.id === ID.TimecodeScale) scale = readUint(c.bytes);
    },
    onTracks(all) {
      tracks = all.filter((t) => t.type === TRACK_TYPE.subtitle).map(toSubtitleTrack);
      textTracks = new Map(tracks.filter((t) => t.supported).map((t) => [t.number, t]));
      onTracks?.(tracks);
      return new Set(textTracks.keys());
    },
    async onBlock(block, cluster) {
      if (block.id === ID.SimpleBlock) return handleBlock(block.data, cluster.timecode, null);
      let body = null;
      let duration = null;
      for (const g of children(block.data)) {
        if (g.id === ID.Block) body = g.bytes;
        else if (g.id === ID.BlockDuration) duration = readUint(g.bytes);
      }
      await handleBlock(body, cluster.timecode, duration);
    },
    onProgress: (fraction) => onProgress?.(fraction, cueCount),
  });
  return isMkv ? { tracks, cueCount } : null;
}
