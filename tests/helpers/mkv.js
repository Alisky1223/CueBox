// Minimal EBML/Matroska writer for building test fixtures in memory.

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const idBytes = (id) => {
  const bytes = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Uint8Array.from(bytes);
};

const sizeBytes = (n) => {
  const b = new Uint8Array(8);
  b[0] = 0x01;
  for (let i = 7, v = n; i > 0; i--, v = Math.floor(v / 256)) b[i] = v & 0xff;
  return b;
};

const UNKNOWN_SIZE = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);

export const el = (id, ...payload) => {
  const data = concat(payload);
  return concat([idBytes(id), sizeBytes(data.length), data]);
};

export const elUnknownSize = (id, ...payload) => concat([idBytes(id), UNKNOWN_SIZE, concat(payload)]);

export const uint = (id, n) => {
  const bytes = [];
  for (let v = n; v > 0 || !bytes.length; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return el(id, Uint8Array.from(bytes));
};

export const str = (id, s) => el(id, new TextEncoder().encode(s));

export const bytes = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : v);

const blockBody = (track, rel, flags, payload) =>
  concat([Uint8Array.of(0x80 | track, (rel >> 8) & 0xff, rel & 0xff, flags), bytes(payload)]);

export const simpleBlock = (track, rel, payload) => el(0xa3, blockBody(track, rel, 0x80, payload));

export const blockGroup = (track, rel, payload, duration) =>
  el(0xa0, el(0xa1, blockBody(track, rel, 0, payload)), uint(0x9b, duration));

export const trackEntry = ({ number, type = 0x11, codec, name, language, compression }) =>
  el(
    0xae,
    uint(0xd7, number),
    uint(0x83, type),
    str(0x86, codec),
    ...(name ? [str(0x536e, name)] : []),
    ...(language ? [str(0x22b59c, language)] : []),
    ...(compression
      ? [
          el(
            0x6d80,
            el(
              0x6240,
              el(
                0x5034,
                uint(0x4254, compression.algo),
                ...(compression.settings ? [el(0x4255, bytes(compression.settings))] : []),
              ),
            ),
          ),
        ]
      : []),
  );

export const cluster = (timecode, ...blocks) => el(0x1f43b675, uint(0xe7, timecode), ...blocks);

export const mkv = ({ tracks, clusters, unknownSizes = false }) => {
  const header = el(0x1a45dfa3, str(0x4282, "matroska"));
  const info = el(0x1549a966, uint(0x2ad7b1, 1_000_000));
  const trackEls = el(0x1654ae6b, ...tracks.map(trackEntry));
  const body = unknownSizes
    ? concat([info, trackEls, ...clusters.map((c) => elUnknownSize(0x1f43b675, uint(0xe7, c.timecode), ...c.blocks))])
    : concat([info, trackEls, ...clusters.map((c) => cluster(c.timecode, ...c.blocks))]);
  const segment = unknownSizes ? elUnknownSize(0x18538067, body) : el(0x18538067, body);
  return new Blob([header, segment]);
};
