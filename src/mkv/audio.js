import { writeElement, writeHeader, writeUint } from "./ebml.js";
import { ID, TRACK_TYPE, readMkvTracks, scanMkv } from "./scan.js";

const CODEC_NAMES = {
  A_AAC: "AAC",
  A_AC3: "AC3",
  A_EAC3: "E-AC3",
  A_DTS: "DTS",
  A_TRUEHD: "TrueHD",
  A_OPUS: "Opus",
  A_VORBIS: "Vorbis",
  A_FLAC: "FLAC",
  "A_MPEG/L3": "MP3",
  "A_MPEG/L2": "MP2",
  A_PCM: "PCM",
};

export function codecName(codec = "") {
  const key = Object.keys(CODEC_NAMES).find((k) => codec === k || codec.startsWith(`${k}/`));
  return key ? CODEC_NAMES[key] : codec.replace(/^A_/, "");
}

/** Lists the audio tracks of a Matroska blob in file order, or null if it is not Matroska. */
export async function readMkvAudioTracks(blob) {
  const tracks = await readMkvTracks(blob);
  if (!tracks) return null;
  return tracks
    .filter((t) => t.type === TRACK_TYPE.audio)
    .map((t, i) => {
      const language = t.ietf || t.language;
      return {
        number: t.number,
        label: [t.name, language].filter(Boolean).join(" – ") || `Track ${i + 1}`,
        language,
        codec: codecName(t.codec),
        isDefault: t.isDefault,
      };
    });
}

/**
 * Copies one track of a Matroska blob into a new, standalone Matroska blob that a media element can play.
 * Blocks are copied unchanged. A Cues index is written before the clusters so seeking stays fast.
 * Returns null if the blob is not Matroska, has no such track, or the signal aborts.
 *
 * @param {Blob} blob
 * @param {number} trackNumber
 * @param {object} [options]
 * @param {(fraction: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 */
export async function extractMkvTrack(blob, trackNumber, { onProgress, signal } = {}) {
  let header = null;
  let info = null;
  let entry = null;
  const clusters = [];
  let source = null;

  const isMkv = await scanMkv(blob, {
    signal,
    onProgress,
    onHeader: (raw) => (header = raw),
    onInfo: ({ raw }) => (info = raw),
    onTracks(all) {
      entry = all.find((t) => t.number === trackNumber);
      return new Set(entry ? [trackNumber] : []);
    },
    onBlock({ raw }, cluster) {
      if (cluster !== source) {
        source = cluster;
        clusters.push({ timecode: cluster.timecode, blocks: [], size: 0 });
      }
      const out = clusters.at(-1);
      out.blocks.push(raw);
      out.size += raw.length;
    },
  });
  if (!isMkv || !entry || signal?.aborted) return null;
  return buildMkv({ header, info, entry, clusters });
}

function buildMkv({ header, info, entry, clusters }) {
  const tracks = writeElement(ID.Tracks, entry.raw.slice());
  const parts = clusters.map((c) => {
    const timecode = writeUint(ID.Timecode, c.timecode);
    return [writeHeader(ID.Cluster, timecode.length + c.size), timecode, ...c.blocks];
  });
  const sizeOf = (list) => list.reduce((n, p) => n + p.length, 0);

  const cues = (positions) =>
    writeElement(
      ID.Cues,
      ...clusters.map((c, i) =>
        writeElement(
          ID.CuePoint,
          writeUint(ID.CueTime, c.timecode),
          writeElement(
            ID.CueTrackPositions,
            writeUint(ID.CueTrack, entry.number),
            writeUint(ID.CueClusterPosition, positions[i]),
          ),
        ),
      ),
    );

  // Fixed-width encoding means the Cues size doesn't depend on the positions it holds.
  const before = [info ?? new Uint8Array(0), tracks];
  let pos = sizeOf(before) + cues(clusters.map(() => 0)).length;
  const positions = parts.map((p) => {
    const at = pos;
    pos += sizeOf(p);
    return at;
  });
  const body = [...before, cues(positions), ...parts.flat()];
  return new Blob([header, writeHeader(ID.Segment, sizeOf(body)), ...body], { type: "audio/webm" });
}
