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
