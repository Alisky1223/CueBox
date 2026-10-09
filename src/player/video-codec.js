import { TRACK_TYPE, readMkvTracks } from "../mkv/scan.js";

// Sample entry fourccs live in the moov box, which sits at either end of an MP4.
const MP4_SNIFF_BYTES = 4 * 1024 * 1024;
const HEVC_PROBE = 'video/mp4; codecs="hvc1.1.6.L93.B0"';
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const STSD = ascii("stsd");
const HEVC_FOURCCS = [ascii("hvc1"), ascii("hev1")];

export const isHevcCodecId = (codec = "") => codec.startsWith("V_MPEGH/ISO/HEVC");

const matchAt = (bytes, i, sig) => sig.every((c, j) => bytes[i + j] === c);

/**
 * True if an MP4 "stsd" box's first sample entry is "hvc1"/"hev1".
 * Layout: stsd, version+flags (4), entry count (4), entry size (4), entry fourcc.
 */
export function hasHevcFourcc(bytes) {
  for (let i = 0; i + 20 <= bytes.length; i++) {
    if (bytes[i] !== STSD[0] || !matchAt(bytes, i, STSD)) continue;
    if (HEVC_FOURCCS.some((f) => matchAt(bytes, i + 16, f))) return true;
  }
  return false;
}

/** Returns "hevc" when the file's video is HEVC/x265, otherwise null. */
export async function detectVideoCodec(file) {
  const tracks = await readMkvTracks(file).catch(() => null);
  if (tracks) return tracks.some((t) => t.type === TRACK_TYPE.video && isHevcCodecId(t.codec)) ? "hevc" : null;

  const read = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const head = await read(file.slice(0, MP4_SNIFF_BYTES));
  if (hasHevcFourcc(head)) return "hevc";
  if (file.size <= MP4_SNIFF_BYTES) return null;
  return hasHevcFourcc(await read(file.slice(-MP4_SNIFF_BYTES))) ? "hevc" : null;
}

export const canDecodeHevc = (video) => video.canPlayType(HEVC_PROBE) !== "";

export const HEVC_HELP =
  "This video is HEVC (x265) and your browser can't decode it.\n" +
  "• Edge: install “HEVC Video Extensions” from the Microsoft Store.\n" +
  "• Chrome/Edge: turn on hardware acceleration (Settings › System).\n" +
  "Your GPU must support HEVC. Otherwise re-encode to H.264.";
