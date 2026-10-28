import "./style.css";
import { extractMkvSubs } from "./mkv/extract.js";
import { AudioTracks } from "./player/audio.js";
import { allowsCors, nameFromUrl, openRemoteFile } from "./player/remote-file.js";
import { SubtitleManager } from "./player/subtitles.js";
import { HEVC_HELP, canDecodeHevc, detectVideoCodec } from "./player/video-codec.js";
import { SUBTITLE_FILE, decodeText, parseSubtitleFile } from "./subtitles/parsers.js";
import { initAudioMenu } from "./ui/audio-menu.js";
import { initControls } from "./ui/controls.js";
import { formatDelay } from "./ui/format.js";
import { renderIcons } from "./ui/icons.js";
import { initLinkForms } from "./ui/link-form.js";
import { closeMenus } from "./ui/menu.js";
import { initPartyMenu } from "./ui/party-menu.js";
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
initAudioMenu({ button: $("audioBtn"), menu: $("audioMenu"), audio, onSelect: switchAudio, onAddLink: askAudioLink });
initSubtitleMenu({
  button: $("ccBtn"),
  menu: $("subMenu"),
  subs,
  onAddFile: () => subInput.click(),
  onAddLink: askSubtitleLink,
});
initPartyMenu({
  button: $("partyBtn"),
  menu: $("partyMenu"),
  video,
  stage,
  chatButton: $("chatBtn"),
  chatPanel: $("chatPanel"),
});
const linkForms = initLinkForms({
  button: $("linkBtn"),
  dialog: $("linkDialog"),
  inline: $("linkForm"),
  isEmpty: () => app.classList.contains("is-empty"),
  onSubmit: openLink,
});

let videoUrl = null;
let pendingLink = null;
let scan = null;
let codec = { hevc: false, warned: false, link: false, cors: false, ready: Promise.resolve() };

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

// ----- installed app (PWA) -----
const secure = location.protocol === "https:" || location.hostname === "localhost";
if (import.meta.env.PROD && secure && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.error(err));
}
// Files opened from the OS ("Open with → CueBox") arrive through the launch queue.
window.launchQueue?.setConsumer(async ({ files }) => {
  if (files?.length) openFiles(await Promise.all(files.map((h) => h.getFile())));
});

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
  openFiles([...e.dataTransfer.files]);
});

function openFiles(files) {
  const isSub = (f) => SUBTITLE_FILE.test(f.name);
  const videoFile = files.find((f) => !isSub(f));
  if (videoFile) openVideo(videoFile);
  files.filter(isSub).forEach(addSubtitleFile);
}

// ----- opening media -----
const isMatroska = (name) => /\.(mkv|mka|webm)$/i.test(name);

/** Resets per-video state and starts playing `src`. Returns the new video's codec state. */
function startVideo(src, name, { link = false, cors = false } = {}) {
  pendingLink = null;
  scan?.abort();
  scan = new AbortController();
  closeMenus();
  subs.reset();
  audio.reset();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = link ? null : src;
  if (cors) video.crossOrigin = "anonymous";
  else video.removeAttribute("crossorigin");
  video.src = src;
  video.play().catch(() => {});

  app.classList.remove("is-empty");
  $("title").textContent = name;
  $("title").title = link ? src : name;
  document.title = `${name} – CueBox`;
  return (codec = { hevc: false, warned: false, link, cors, ready: Promise.resolve() });
}

function openVideo(file) {
  const current = startVideo(URL.createObjectURL(file), file.name);
  current.ready = inspectVideo(file, current);
}

// The <video> streams the link directly, which works with any server. Reading the file's bytes
// (audio tracks, HEVC check) also needs the server to allow CORS range requests. Embedded subtitles aren't
// scanned for links: they're spread through the whole file, so finding them means downloading all of it.
// When it allows CORS the video is loaded in CORS mode, else Web Audio (used to swap in another audio track) only gets silence from it.
async function openLink(url) {
  const name = nameFromUrl(url);
  const token = (pendingLink = {});
  const cors = await allowsCors(url, { signal: AbortSignal.timeout(5000) }).catch(() => false);
  if (token !== pendingLink) return;
  const current = startVideo(url, name, { link: true, cors });
  const { signal } = scan;
  current.ready = openRemoteFile(url, { signal })
    .then((file) => {
      if (signal.aborted) return;
      if (file) return inspectVideo(file, current);
      if (isMatroska(name))
        toast("This server doesn't let CueBox read the file, so embedded audio tracks aren't available.", {
          duration: 6000,
        });
    })
    .catch((err) => !signal.aborted && console.error(err));
}

/** Reads the file itself (local or linked) for embedded tracks. Resolves once its codec is known. */
function inspectVideo(file, current) {
  if (isMatroska(file.name)) {
    audio.loadMkv(file).catch((err) => console.error(err));
    if (!current.link) {
      const { signal } = scan;
      loadEmbeddedSubs(file, signal).catch((err) => {
        console.error(err);
        if (!signal.aborted) toast(`Subtitle scan failed: ${err.message}`, { type: "error" });
      });
    }
  }

  return detectVideoCodec(file)
    .then((kind) => {
      if (current !== codec || kind !== "hevc") return;
      current.hevc = true;
      const noFrames = video.readyState >= HTMLMediaElement.HAVE_METADATA && !video.videoWidth;
      if (!canDecodeHevc(video) || noFrames) warnHevc();
    })
    .catch((err) => console.error(err));
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
  if (current.link)
    return toast("Couldn't play this link. Make sure it points straight to a video file, not a web page.", {
      type: "error",
      duration: 6000,
    });
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
  addSubtitles(file.name, new Uint8Array(await file.arrayBuffer()));
}

function addSubtitles(name, bytes) {
  const cues = parseSubtitleFile(name, decodeText(bytes));
  if (!cues.length) return toast(`No subtitles found in ${name}`, { type: "error" });
  const entry = subs.add(name, { source: "file" });
  for (const c of cues) subs.addCue(entry, c.start, c.end, c.text);
  subs.select(subs.entries.length - 1);
  toast(`Loaded ${name}`, { type: "success" });
}

// fetch() rejects with a TypeError when the server doesn't allow CORS (or can't be reached).
const linkError = (err) => (err instanceof TypeError ? "the server doesn't allow it (CORS)" : err.message);

function askSubtitleLink() {
  linkForms.ask({
    title: "Add subtitle from a link",
    action: "Add",
    placeholder: "https://example.com/subtitle.srt",
    note: "Paste a direct link to an .srt, .vtt, .ass or .ssa file. The server must allow CORS.",
    onSubmit: addSubtitleLink,
  });
}

async function addSubtitleLink(url) {
  const name = nameFromUrl(url);
  const current = codec;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (current === codec) addSubtitles(name, bytes);
  } catch (err) {
    console.error(err);
    toast(`Couldn't load ${name}: ${linkError(err)}`, { type: "error", duration: 6000 });
  }
}

function askAudioLink() {
  if (!video.src) return toast("Open a video first, then add audio.", { type: "error" });
  linkForms.ask({
    title: "Add audio from a link",
    action: "Add",
    placeholder: "https://example.com/dub.mka",
    note:
      "Paste a direct link to an audio file (e.g. a dub). It plays in sync with the video and works with any server." +
      (codec.link && !codec.cors
        ? " This video's server doesn't allow CORS, so once you switch to another audio track, the original sound comes back only after reopening the video."
        : ""),
    onSubmit: (url) => switchAudio(audio.addLink(url, nameFromUrl(url))),
  });
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
    u: () => linkForms.open(),
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
