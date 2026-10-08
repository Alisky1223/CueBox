export const SUBTITLE_FILE = /\.(srt|vtt|ass|ssa)$/i;

// Non-UTF-8 subtitles are usually Persian/Arabic Windows-1256.
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

export function parseTime(s) {
  const parts = s.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

export function parseSrtVtt(text) {
  const cues = [];
  for (const block of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = parseTime(a);
    const end = parseTime(b.trim().split(/\s+/)[0]);
    const body = lines
      .slice(i + 1)
      .join("\n")
      .trim();
    if (body && !isNaN(start) && !isNaN(end)) cues.push({ start, end, text: body });
  }
  return cues;
}

export function parseAss(text) {
  let fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
  const cues = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (/^Format:/i.test(line) && /text/i.test(line)) {
      fields = line
        .slice(7)
        .split(",")
        .map((f) => f.trim().toLowerCase());
    } else if (/^Dialogue:/i.test(line)) {
      const values = splitN(line.slice(9), ",", fields.length);
      const get = (f) => values[fields.indexOf(f)] ?? "";
      const body = cleanAss(get("text"));
      if (body) cues.push({ start: parseTime(get("start")), end: parseTime(get("end")), text: body });
    }
  }
  return cues;
}

export function parseSubtitleFile(name, text) {
  return /\.(ass|ssa)$/i.test(name) ? parseAss(text) : parseSrtVtt(text);
}

export function splitN(s, sep, n) {
  const out = [];
  while (out.length < n - 1) {
    const i = s.indexOf(sep);
    if (i < 0) break;
    out.push(s.slice(0, i));
    s = s.slice(i + 1);
  }
  out.push(s);
  return out;
}

export function cleanAss(text) {
  if (/\{[^}]*\\p[1-9]/.test(text)) return ""; // vector drawing, not text
  return text
    .replace(/\{\\i1\}/g, "<i>")
    .replace(/\{\\i0\}/g, "</i>")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/gi, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

// VTTCue text is markup: keep <i>/<b>/<u>, drop other tags, escape the rest.
export function toCueText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/<(\/?)([ibu])>/gi, "\x01$1$2\x02")
    .replace(/<[^>]*>/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\x01/g, "<")
    .replace(/\x02/g, ">");
}
