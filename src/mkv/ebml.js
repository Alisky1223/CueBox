const CHUNK = 4 << 20;

export function vintLen(byte) {
  for (let i = 0; i < 8; i++) if (byte & (0x80 >> i)) return i + 1;
  return 0;
}

export function readId(b, off) {
  const len = vintLen(b[off]);
  if (!len || len > 4) throw new Error("corrupt EBML id");
  let value = 0;
  for (let i = 0; i < len; i++) value = value * 256 + b[off + i];
  return { value, len };
}

export function readVint(b, off) {
  const len = vintLen(b[off]);
  if (!len || off + len > b.length) return null;
  let value = b[off] & (0xff >> len);
  let allOnes = value === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[off + i];
    if (b[off + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: allOnes };
}

export function* children(b, start = 0, end = b.length) {
  let p = start;
  while (p < end) {
    const id = readId(b, p);
    const size = readVint(b, p + id.len);
    if (!size) return;
    const data = p + id.len + size.len;
    yield { id: id.value, start: p, data, end: data + size.value, bytes: b.subarray(data, data + size.value) };
    p = data + size.value;
  }
}

export const readUint = (b) => b.reduce((acc, v) => acc * 256 + v, 0);
export const readStr = (b) => new TextDecoder().decode(b).replace(/\0+$/, "");

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const idBytes = (id) => {
  const bytes = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Uint8Array.from(bytes);
};

// Fixed 8-byte sizes and uints keep element lengths predictable, so offsets can be computed up front.
const fixed8 = (n, marker = 0) => {
  const b = new Uint8Array(8);
  for (let i = 7, v = n; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v & 0xff;
  b[0] |= marker;
  return b;
};

/** Element header (id + 8-byte size) for a payload of `size` bytes. */
export const writeHeader = (id, size) => concat([idBytes(id), fixed8(size, 0x01)]);

export const writeElement = (id, ...payload) => {
  const data = concat(payload);
  return concat([writeHeader(id, data.length), data]);
};

export const writeUint = (id, n) => writeElement(id, fixed8(n));

/** Random-access reader over a Blob/File with a single cached window. */
export class Reader {
  constructor(blob) {
    this.blob = blob;
    this.size = blob.size;
    this.start = 0;
    this.buf = new Uint8Array(0);
  }

  /** Returned view is only valid until the next call; `.slice()` it to keep it. */
  async bytes(pos, len) {
    len = Math.min(len, this.size - pos);
    if (pos < this.start || pos + len > this.start + this.buf.length) {
      const end = Math.min(this.size, pos + Math.max(len, CHUNK));
      this.buf = new Uint8Array(await this.blob.slice(pos, end).arrayBuffer());
      this.start = pos;
    }
    return this.buf.subarray(pos - this.start, pos - this.start + len);
  }

  async header(pos) {
    const b = await this.bytes(pos, 12);
    const id = readId(b, 0);
    const size = readVint(b, id.len);
    if (!size) throw new Error("corrupt EBML");
    return { id: id.value, size: size.unknown ? -1 : size.value, data: pos + id.len + size.len };
  }
}
