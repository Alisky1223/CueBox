import "./style.css";
import { extractMkvSubs } from "./mkv/extract.js";
import { SUBTITLE_FILE, decodeText, parseSubtitleFile, toCueText } from "./subtitles/parsers.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const subSelect = $("subSelect");
let video = $("video");
let videoUrl = null;
let subs = [];
let scan = null;

$("openBtn").onclick = () => $("videoInput").click();
$("subBtn").onclick = () => $("subInput").click();
$("videoInput").onchange = (e) => e.target.files[0] && openVideo(e.target.files[0]);
$("subInput").onchange = (e) => e.target.files[0] && addSubtitleFile(e.target.files[0]);
subSelect.onchange = () => selectSub(subSelect.value);

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("drag");
});
document.addEventListener("dragleave", () => document.body.classList.remove("drag"));
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drag");
  const isSub = (f) => SUBTITLE_FILE.test(f.name);
  const files = [...e.dataTransfer.files];
  files.filter((f) => !isSub(f)).forEach(openVideo);
  files.filter(isSub).forEach(addSubtitleFile);
});

function setStatus(text) {
  statusEl.textContent = text;
}

// Text tracks cannot be removed from a <video>, so each new file gets a fresh element.
function openVideo(file) {
  scan?.abort();
  scan = new AbortController();
  const fresh = document.createElement("video");
  fresh.id = "video";
  fresh.controls = true;
  video.replaceWith(fresh);
  video = fresh;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  video.src = videoUrl;
  video.onerror = () => setStatus(`Cannot play ${file.name} (unsupported codec?)`);
  video.textTracks.onchange = syncSelectFromTracks;
  document.title = `${file.name} – CueBox`;
  subs = [];
  subSelect.length = 1;
  subSelect.value = "off";
  video.play().catch(() => {});

  if (/\.(mkv|mka|webm)$/i.test(file.name)) {
    const { signal } = scan;
    loadEmbeddedSubs(file, signal).catch((err) => {
      console.error(err);
      if (!signal.aborted) setStatus(`Subtitle scan failed: ${err.message}`);
    });
  } else {
    setStatus(file.name);
  }
}

async function loadEmbeddedSubs(file, signal) {
  const byNumber = new Map();
  let lastUi = 0;
  const result = await extractMkvSubs(file, {
    signal,
    onTracks(tracks) {
      let pick = null;
      for (const t of tracks) {
        if (!t.supported) {
          addUnsupported(t.label);
          continue;
        }
        byNumber.set(t.number, addTrack(t.label, t.language));
        if (pick === null || (t.isDefault && !pick.isDefault)) pick = { index: subs.length - 1, ...t };
      }
      if (pick) selectSub(String(pick.index));
    },
    onCue(number, { start, end, text }) {
      addCue(byNumber.get(number), start, end, text);
    },
    onProgress(fraction, cueCount) {
      const now = performance.now();
      if (now - lastUi < 200) return;
      lastUi = now;
      setStatus(`${file.name} — scanning subtitles ${Math.floor(fraction * 100)}% (${cueCount} cues)`);
    },
  });
  if (signal.aborted) return;
  if (!result || !byNumber.size) return setStatus(`${file.name} — no embedded text subtitles`);
  setStatus(`${file.name} — ${byNumber.size} embedded subtitle track(s), ${result.cueCount} cues`);
}

function addTrack(label, lang) {
  const track = video.addTextTrack("subtitles", label, lang || "");
  track.mode = "hidden";
  subs.push(track);
  subSelect.add(new Option(label, String(subs.length - 1)));
  return track;
}

function addUnsupported(label) {
  const opt = new Option(`${label} (image sub, unsupported)`, "");
  opt.disabled = true;
  subSelect.add(opt);
}

function selectSub(value) {
  subs.forEach((t, i) => (t.mode = String(i) === value ? "showing" : "hidden"));
  subSelect.value = value;
}

function syncSelectFromTracks() {
  const i = subs.findIndex((t) => t.mode === "showing");
  subSelect.value = i < 0 ? "off" : String(i);
}

function addCue(track, start, end, text) {
  if (end <= start) end = start + 3;
  track.addCue(new VTTCue(start, end, toCueText(text)));
}

async function addSubtitleFile(file) {
  if (!video.src) return setStatus("Open a video first");
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  const cues = parseSubtitleFile(file.name, text);
  if (!cues.length) return setStatus(`No cues found in ${file.name}`);
  const track = addTrack(file.name);
  for (const c of cues) addCue(track, c.start, c.end, c.text);
  selectSub(String(subs.length - 1));
  setStatus(`Loaded ${file.name} (${cues.length} cues)`);
}
