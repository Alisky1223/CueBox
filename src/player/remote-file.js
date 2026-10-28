/** Last path segment of a link, decoded, used as the video's display name. */
export function nameFromUrl(url) {
  try {
    const { pathname, hostname } = new URL(url);
    const last = pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : hostname;
  } catch {
    return url;
  }
}

/** Returns a normalized http(s) URL, or null if the input isn't one. */
export function parseVideoUrl(input) {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const totalFromContentRange = (header) => {
  const total = /\/(\d+)\s*$/.exec(header ?? "")?.[1];
  return total ? Number(total) : null;
};

/**
 * The parts of a Blob the MKV and codec readers use (`size`, `name`, `slice().arrayBuffer()`),
 * backed by HTTP range requests so a linked video can be scanned without downloading it whole.
 */
export class RemoteFile {
  constructor(url, size, { name = nameFromUrl(url), fetch = globalThis.fetch, signal } = {}) {
    this.url = url;
    this.size = size;
    this.name = name;
    this.fetch = fetch;
    this.signal = signal;
  }

  slice(start = 0, end = this.size) {
    const clamp = (n) => Math.min(this.size, Math.max(0, n < 0 ? this.size + n : n));
    const from = clamp(start);
    const to = Math.max(from, clamp(end));
    return { size: to - from, arrayBuffer: () => this.read(from, to) };
  }

  async read(from, to) {
    if (from === to) return new ArrayBuffer(0);
    const res = await this.fetch(this.url, { headers: { Range: `bytes=${from}-${to - 1}` }, signal: this.signal });
    if (res.status !== 206) throw new Error(`server didn't return a byte range (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();
    return buf.byteLength > to - from ? buf.slice(0, to - from) : buf;
  }
}

/** Whether the page may read the link's response, checked with a plain GET so no CORS preflight is needed. */
export async function allowsCors(url, { fetch = globalThis.fetch, signal } = {}) {
  try {
    const res = await fetch(url, { signal });
    res.body?.cancel().catch(() => {});
    return res.ok;
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}

/**
 * Checks whether the page may read the link's bytes: the server must allow CORS and support range requests.
 * Resolves to a RemoteFile, or null when it can only be streamed by the <video> element.
 */
export async function openRemoteFile(url, { fetch = globalThis.fetch, signal } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { Range: "bytes=0-0" }, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
  res.body?.cancel().catch(() => {});
  if (res.status !== 206) return null;
  let size = totalFromContentRange(res.headers.get("Content-Range"));
  // Content-Range is hidden unless the server exposes it; Content-Length of a HEAD response never is.
  if (!size) {
    const head = await fetch(url, { method: "HEAD", signal }).catch((err) => {
      if (signal?.aborted) throw err;
      return null;
    });
    size = Number(head?.headers.get("Content-Length")) || null;
  }
  return size ? new RemoteFile(url, size, { fetch, signal }) : null;
}
