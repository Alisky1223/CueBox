import { formatTime } from "./format.js";
import { icon, setIcon } from "./icons.js";
import { closeMenus, isMenuOpen, toggleMenu } from "./menu.js";
import { load, save } from "./storage.js";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const IDLE_MS = 2500;

export function initControls({ stage, video }) {
  const $ = (id) => document.getElementById(id);
  const playBtn = $("playBtn");
  const muteBtn = $("muteBtn");
  const volume = $("volume");
  const time = $("time");
  const seek = $("seek");
  const fsBtn = $("fsBtn");
  const pipBtn = $("pipBtn");
  const speedBtn = $("speedBtn");
  const speedMenu = $("speedMenu");
  const flashEl = $("flash");
  const spinner = $("spinner");

  // ----- play / pause -----
  const togglePlay = () => {
    if (!video.src) return;
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  };
  playBtn.onclick = togglePlay;
  video.addEventListener("click", () => {
    if (isMenuOpen()) return closeMenus();
    togglePlay();
    flash(video.paused ? "pause" : "play");
  });
  video.addEventListener("dblclick", () => toggleFullscreen());
  const syncPlay = () => {
    setIcon(playBtn, video.paused ? "play" : "pause");
    playBtn.title = video.paused ? "Play (Space)" : "Pause (Space)";
    stage.classList.toggle("paused", video.paused);
    wake();
  };
  video.addEventListener("play", syncPlay);
  video.addEventListener("pause", syncPlay);

  // ----- seeking -----
  const seekBy = (delta) => {
    if (!video.duration) return;
    video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), video.duration);
    flash(delta < 0 ? "back10" : "fwd10", `${delta > 0 ? "+" : "−"}${Math.abs(delta)}s`);
  };
  $("backBtn").onclick = () => seekBy(-10);
  $("fwdBtn").onclick = () => seekBy(10);

  let scrubbing = false;
  const fractionAt = (e) => {
    const r = seek.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  };
  const drawProgress = (fraction) => {
    seek.style.setProperty("--progress", fraction);
  };
  seek.addEventListener("pointermove", (e) => {
    const f = fractionAt(e);
    seek.style.setProperty("--hover", f);
    $("seekTooltip").textContent = formatTime(f * (video.duration || 0));
    if (scrubbing) {
      drawProgress(f);
      video.currentTime = f * video.duration;
    }
  });
  seek.addEventListener("pointerdown", (e) => {
    if (!video.duration) return;
    scrubbing = true;
    seek.setPointerCapture(e.pointerId);
    seek.classList.add("scrubbing");
    const f = fractionAt(e);
    drawProgress(f);
    video.currentTime = f * video.duration;
  });
  const endScrub = () => {
    scrubbing = false;
    seek.classList.remove("scrubbing");
  };
  seek.addEventListener("pointerup", endScrub);
  seek.addEventListener("pointercancel", endScrub);

  const syncTime = () => {
    const d = video.duration || 0;
    if (!scrubbing) drawProgress(d ? video.currentTime / d : 0);
    time.textContent = `${formatTime(video.currentTime)} / ${formatTime(d)}`;
    const b = video.buffered;
    seek.style.setProperty("--buffered", d && b.length ? b.end(b.length - 1) / d : 0);
  };
  for (const ev of ["timeupdate", "durationchange", "progress", "seeked", "emptied"])
    video.addEventListener(ev, syncTime);

  // ----- volume -----
  const syncVolume = () => {
    const v = video.muted ? 0 : video.volume;
    volume.value = v;
    volume.style.setProperty("--fill", v);
    setIcon(muteBtn, v === 0 ? "volume-x" : v < 0.5 ? "volume-low" : "volume");
    save("volume", video.volume);
    save("muted", video.muted);
  };
  video.volume = load("volume", 1);
  video.muted = load("muted", false);
  video.addEventListener("volumechange", syncVolume);
  syncVolume();
  volume.oninput = () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
  };
  const toggleMute = () => {
    if (video.muted && video.volume === 0) video.volume = 0.5;
    video.muted = !video.muted;
    flash(video.muted ? "volume-x" : "volume", video.muted ? "Muted" : `${Math.round(video.volume * 100)}%`);
  };
  muteBtn.onclick = toggleMute;
  const changeVolume = (delta) => {
    video.muted = false;
    video.volume = Math.min(Math.max(Math.round((video.volume + delta) * 100) / 100, 0), 1);
    flash(video.volume === 0 ? "volume-x" : "volume", `${Math.round(video.volume * 100)}%`);
  };

  // ----- speed -----
  const renderSpeedMenu = () => {
    speedMenu.innerHTML = `<div class="menu-title">Speed</div>${SPEEDS.map(
      (s) =>
        `<button class="menu-item${s === video.playbackRate ? " selected" : ""}" data-speed="${s}"><span class="menu-check">${icon("check")}</span>${s === 1 ? "Normal" : `${s}×`}</button>`,
    ).join("")}`;
  };
  speedBtn.onclick = () => {
    renderSpeedMenu();
    toggleMenu(speedBtn, speedMenu);
  };
  speedMenu.onclick = (e) => {
    const item = e.target.closest("[data-speed]");
    if (!item) return;
    video.playbackRate = Number(item.dataset.speed);
    closeMenus();
  };
  video.addEventListener("ratechange", () => {
    speedBtn.textContent = `${video.playbackRate}×`;
    // A new src resets playbackRate to defaultPlaybackRate, so keep the user's choice.
    video.defaultPlaybackRate = video.playbackRate;
  });

  // ----- fullscreen / PiP -----
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen?.().catch(() => {});
  };
  fsBtn.onclick = toggleFullscreen;
  document.addEventListener("fullscreenchange", () => {
    const fs = document.fullscreenElement === stage;
    setIcon(fsBtn, fs ? "minimize" : "maximize");
    fsBtn.title = fs ? "Exit fullscreen (F)" : "Fullscreen (F)";
  });

  if (!document.pictureInPictureEnabled) pipBtn.hidden = true;
  pipBtn.onclick = () => {
    if (document.pictureInPictureElement) document.exitPictureInPicture();
    else video.requestPictureInPicture().catch(() => {});
  };

  // ----- loading spinner -----
  video.addEventListener("waiting", () => spinner.classList.add("visible"));
  for (const ev of ["playing", "canplay", "pause", "emptied", "error"])
    video.addEventListener(ev, () => spinner.classList.remove("visible"));

  // ----- center flash -----
  let flashTimer;
  function flash(name, text = "") {
    flashEl.innerHTML = `${icon(name)}${text ? `<span>${text}</span>` : ""}`;
    flashEl.classList.remove("show");
    void flashEl.offsetWidth; // restart the animation
    flashEl.classList.add("show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flashEl.classList.remove("show"), 700);
  }

  // ----- auto-hide controls -----
  let idleTimer;
  function wake() {
    stage.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!video.paused && !isMenuOpen() && !scrubbing) stage.classList.add("idle");
    }, IDLE_MS);
  }
  stage.addEventListener("pointermove", wake);
  stage.addEventListener("pointerdown", wake);
  stage.addEventListener("pointerleave", () => {
    if (!video.paused && !isMenuOpen()) stage.classList.add("idle");
  });
  // Mouse clicks shouldn't leave focus on buttons, or Space would re-trigger them.
  stage.addEventListener("pointerup", (e) => e.pointerType === "mouse" && e.target.closest("button")?.blur());

  syncPlay();
  syncTime();

  return { togglePlay, seekBy, toggleMute, changeVolume, toggleFullscreen, flash, wake };
}
