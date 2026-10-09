import "./style.css";
import { extractMkvSubs } from "./mkv/extract.js";
import { AudioTracks } from "./player/audio.js";
import { SubtitleManager } from "./player/subtitles.js";
import { HEVC_HELP, canDecodeHevc, detectVideoCodec } from "./player/video-codec.js";
import { SUBTITLE_FILE, decodeText, parseSubtitleFile } from "./subtitles/parsers.js";
import { initAudioMenu } from "./ui/audio-menu.js";
import { initControls } from "./ui/controls.js";
import { formatDelay } from "./ui/format.js";
import { renderIcons } from "./ui/icons.js";
import { closeMenus } from "./ui/menu.js";
import { DELAY_STEP, initSubtitleMenu } from "./ui/subtitle-menu.js";
import { progressToast, toast } from "./ui/toast.js";

const $ = (id) => document.getElementById(id);
const app = $("app");
const stage = $("stage");
const video = $("video");
const videoInput = $("videoInput");
const subInput = $("subInput");

renderIcons();
const subs = new SubtitleManager(video);
const controls = initControls({ stage, video });
const audio = new AudioTracks(video);
initAudioMenu({ button: $("audioBtn"), menu: $("audioMenu"), audio, onSelect: switchAudio });
initSubtitleMenu({ button: $("ccBtn"), menu: $("subMenu"), subs, onAddFile: () => subInput.click() });

let videoUrl = null;
let scan = null;
let codec = { hevc: false, warned: false, ready: Promise.resolve() };

const pickVideo = () => videoInput.click();
$("openBtn").onclick = pickVideo;
$("dropzone").onclick = pickVideo;
$("subBtn").onclick = () => subInput.click();
// Reset the value so picking the same file again still fires change.
videoInput.onchange = () => {
  if (videoInput.files[0]) openVideo(videoInput.files[0]);
  videoInput.value = "";
};
subInput.onchange = () => {
  if (subInput.files[0]) addSubtitleFile(subInput.files[0]);
  subInput.value = "";
};

// ----- drag & drop -----
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  app.classList.add("dragging");
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    app.classList.remove("dragging");
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove("dragging");
  const isSub = (f) => SUBTITLE_FILE.test(f.name);
  const files = [...e.dataTransfer.files];
  const videoFile = files.find((f) => !isSub(f));
  if (videoFile) openVideo(videoFile);
  files.filter(isSub).forEach(addSubtitleFile);
});

// ----- opening media -----
function openVideo(file) {
  scan?.abort();
  scan = new AbortController();
  closeMenus();
  subs.reset();
  audio.reset();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  video.src = videoUrl;
  video.play().catch(() => {});

  app.classList.remove("is-empty");
  $("title").textContent = file.name;
  $("title").title = file.name;
  document.title = `${file.name} – CueBox`;

  const current = (codec = { hevc: false, warned: false });
  current.ready = detectVideoCodec(file)
    .then((kind) => {
      if (current !== codec || kind !== "hevc") return;
      current.hevc = true;
      const noFrames = video.readyState >= HTMLMediaElement.HAVE_METADATA && !video.videoWidth;
      if (!canDecodeHevc(video) || noFrames) warnHevc();
    })
    .catch((err) => console.error(err));

  if (/\.(mkv|mka|webm)$/i.test(file.name)) {
    audio.loadMkv(file).catch((err) => console.error(err));
    const { signal } = scan;
    loadEmbeddedSubs(file, signal).catch((err) => {
      console.error(err);
      if (!signal.aborted) toast(`Subtitle scan failed: ${err.message}`, { type: "error" });
    });
  }
}

function warnHevc() {
  if (codec.warned) return;
  codec.warned = true;
  toast(HEVC_HELP, { type: "error", duration: 15000 });
}

// Chrome without an HEVC decoder plays the audio and leaves the picture black instead of failing.
video.addEventListener("loadedmetadata", () => {
  if (codec.hevc && !video.videoWidth) warnHevc();
});

video.addEventListener("error", async () => {
  if (!video.src) return;
  const current = codec;
  await current.ready;
  if (current !== codec) return;
  if (current.hevc) return warnHevc();
  toast("This video can't be played. Its codec may not be supported by your browser.", {
    type: "error",
    duration: 6000,
  });
});

async function loadEmbeddedSubs(file, signal) {
  const byNumber = new Map();
  const progress = progressToast("Scanning for subtitles…");
  signal.addEventListener("abort", () => progress.close());
  let lastUi = 0;

  const result = await extractMkvSubs(file, {
    signal,
    onTracks(tracks) {
      let pick = null;
      for (const t of tracks) {
        const entry = subs.add(t.label, { language: t.language, supported: t.supported });
        if (!t.supported) continue;
        byNumber.set(t.number, entry);
        if (!pick || (t.isDefault && !pick.isDefault)) pick = { index: subs.entries.length - 1, ...t };
      }
      if (pick) subs.select(pick.index);
    },
    onCue(number, { start, end, text }) {
      subs.addCue(byNumber.get(number), start, end, text);
    },
    onProgress(fraction, cueCount) {
      const now = performance.now();
      if (now - lastUi < 150) return;
      lastUi = now;
      progress.update(fraction, `Loading subtitles… ${cueCount} lines`);
    },
  });

  if (signal.aborted) return;
  if (!result || !byNumber.size) {
    const unsupported = result?.tracks.length ?? 0;
    return progress.close(
      unsupported ? "Only image subtitles found (unsupported)" : "No embedded subtitles",
      unsupported ? "error" : "info",
    );
  }
  const n = byNumber.size;
  progress.close(`${n} subtitle track${n > 1 ? "s" : ""} loaded · ${result.cueCount} lines`);
}

async function switchAudio(index) {
  const entry = audio.entries[index];
  let progress = null;
  let lastUi = 0;
  try {
    const switched = await audio.select(index, {
      onProgress(fraction) {
        const now = performance.now();
        if (now - lastUi < 150) return;
        lastUi = now;
        progress ??= progressToast(`Loading audio: ${entry.label}`);
        progress.update(fraction, `Loading audio: ${entry.label} · ${Math.round(fraction * 100)}%`);
      },
    });
    progress?.close(switched ? `Audio: ${entry.label}` : undefined);
  } catch (err) {
    console.error(err);
    progress?.close();
    toast(`Can't play audio "${entry.label}": ${err.message}`, { type: "error", duration: 6000 });
  }
}

async function addSubtitleFile(file) {
  if (!video.src) return toast("Open a video first, then add subtitles.", { type: "error" });
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  const cues = parseSubtitleFile(file.name, text);
  if (!cues.length) return toast(`No subtitles found in ${file.name}`, { type: "error" });
  const entry = subs.add(file.name, { source: "file" });
  for (const c of cues) subs.addCue(entry, c.start, c.end, c.text);
  subs.select(subs.entries.length - 1);
  toast(`Loaded ${file.name}`, { type: "success" });
}

// ----- keyboard -----
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target;
  if (target.closest?.("button") && (e.key === " " || e.key === "Enter")) return;
  if (target.tagName === "INPUT" && target.type !== "range") return;

  const actions = {
    " ": () => controls.togglePlay(),
    k: () => controls.togglePlay(),
    ArrowLeft: () => controls.seekBy(-5),
    ArrowRight: () => controls.seekBy(5),
    j: () => controls.seekBy(-10),
    l: () => controls.seekBy(10),
    ArrowUp: () => controls.changeVolume(0.05),
    ArrowDown: () => controls.changeVolume(-0.05),
    m: () => controls.toggleMute(),
    f: () => controls.toggleFullscreen(),
    o: () => pickVideo(),
    c: () => {
      if (!subs.hasUsable) return controls.flash("captions", "No subtitles");
      const entry = subs.cycle();
      controls.flash("captions", entry ? entry.label : "Subtitles off");
    },
    a: () => {
      const next = audio.next();
      if (next === null) return controls.flash("headphones", "No other audio tracks");
      controls.flash("headphones", audio.entries[next].label);
      switchAudio(next);
    },
    g: () => shiftDelay(-1),
    h: () => shiftDelay(1),
  };
  const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!action) return;
  e.preventDefault();
  if (target.type === "range") target.blur();
  action();
  controls.wake();
});

function shiftDelay(dir) {
  if (!subs.hasUsable) return;
  subs.setDelay(subs.delay + dir * DELAY_STEP);
  controls.flash("captions", `Delay ${formatDelay(subs.delay)}`);
}

window.cueboxReady = true;
