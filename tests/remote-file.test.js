import { describe, expect, it } from "vitest";
import { readMkvTracks } from "../src/mkv/scan.js";
import { RemoteFile, allowsCors, nameFromUrl, openRemoteFile, parseVideoUrl } from "../src/player/remote-file.js";
import { mkv, simpleBlock } from "./helpers/mkv.js";

/** A fetch that serves `bytes` like a CORS-enabled server with range support. */
function rangeServer(bytes, { exposeRange = true, ranges = true } = {}) {
  const requests = [];
  const fetch = async (url, { method = "GET", headers = {} } = {}) => {
    requests.push({ method, range: headers.Range });
    if (method === "HEAD") return new Response(null, { headers: { "Content-Length": String(bytes.length) } });
    const m = /^bytes=(\d+)-(\d+)$/.exec(headers.Range ?? "");
    if (!ranges || !m) return new Response(bytes, { status: 200 });
    const [from, to] = [Number(m[1]), Math.min(Number(m[2]), bytes.length - 1)];
    const h = exposeRange ? { "Content-Range": `bytes ${from}-${to}/${bytes.length}` } : {};
    return new Response(bytes.slice(from, to + 1), { status: 206, headers: h });
  };
  return { fetch, requests };
}

const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
const read = async (part) => [...new Uint8Array(await part.arrayBuffer())];

describe("parseVideoUrl", () => {
  it("accepts http(s) links and trims spaces", () => {
    expect(parseVideoUrl("  https://example.com/a b.mp4 ")).toBe("https://example.com/a%20b.mp4");
    expect(parseVideoUrl("http://example.com/v.mkv")).toBe("http://example.com/v.mkv");
  });

  it("rejects other schemes and garbage", () => {
    expect(parseVideoUrl("file:///C:/v.mkv")).toBeNull();
    expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
    expect(parseVideoUrl("not a url")).toBeNull();
  });
});

describe("nameFromUrl", () => {
  it("uses the decoded last path segment", () => {
    expect(nameFromUrl("https://example.com/films/My%20Movie.mkv?token=1")).toBe("My Movie.mkv");
  });

  it("falls back to the host name", () => {
    expect(nameFromUrl("https://example.com/")).toBe("example.com");
  });
});

describe("allowsCors", () => {
  it("checks with a plain GET, without a Range header", async () => {
    const { fetch, requests } = rangeServer(bytes);
    expect(await allowsCors("https://x/v.mkv", { fetch })).toBe(true);
    expect(requests).toEqual([{ method: "GET", range: undefined }]);
  });

  it("is false when CORS blocks the request or the server errors", async () => {
    expect(await allowsCors("https://x/v", { fetch: () => Promise.reject(new TypeError("Failed to fetch")) })).toBe(
      false,
    );
    expect(await allowsCors("https://x/v", { fetch: async () => new Response(null, { status: 404 }) })).toBe(false);
  });
});

describe("openRemoteFile", () => {
  it("reads the size from Content-Range", async () => {
    const { fetch, requests } = rangeServer(bytes);
    const file = await openRemoteFile("https://x/v.mkv", { fetch });
    expect(file.size).toBe(100);
    expect(file.name).toBe("v.mkv");
    expect(requests).toEqual([{ method: "GET", range: "bytes=0-0" }]);
  });

  it("falls back to a HEAD request when Content-Range isn't exposed", async () => {
    const { fetch, requests } = rangeServer(bytes, { exposeRange: false });
    expect((await openRemoteFile("https://x/v.mkv", { fetch })).size).toBe(100);
    expect(requests.at(-1).method).toBe("HEAD");
  });

  it("returns null without range support or when CORS blocks the request", async () => {
    expect(await openRemoteFile("https://x/v", { fetch: rangeServer(bytes, { ranges: false }).fetch })).toBeNull();
    const blocked = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await openRemoteFile("https://x/v", { fetch: blocked })).toBeNull();
  });
});

describe("RemoteFile", () => {
  it("slices like a Blob, including negative offsets", async () => {
    const file = new RemoteFile("https://x/v", 100, { fetch: rangeServer(bytes).fetch });
    expect(await read(file.slice(10, 13))).toEqual([10, 11, 12]);
    expect(await read(file.slice(-2))).toEqual([98, 99]);
    expect(await read(file.slice(98, 500))).toEqual([98, 99]);
    expect(await read(file.slice(5, 5))).toEqual([]);
  });

  it("is readable by the MKV scanner", async () => {
    const data = new Uint8Array(
      await mkv({
        tracks: [{ number: 1, type: 0x11, codec: "S_TEXT/UTF8", language: "eng" }],
        clusters: [{ timecode: 0, blocks: [simpleBlock(1, 0, "hi")] }],
      }).arrayBuffer(),
    );
    const file = await openRemoteFile("https://x/v.mkv", { fetch: rangeServer(data).fetch });
    const tracks = await readMkvTracks(file);
    expect(tracks.map((t) => t.codec)).toEqual(["S_TEXT/UTF8"]);
  });
});
