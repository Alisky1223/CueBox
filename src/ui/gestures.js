import { formatTime } from "./format.js";
import { icon } from "./icons.js";
import { load, save } from "./storage.js";

const DRAG_THRESHOLD = 12;
const SEEK_SECONDS_PER_WIDTH = 90;
const BRIGHTNESS_MIN = 0.3;
const BRIGHTNESS_MAX = 1.5;
const CLICK_GUARD_MS = 400;
// The controls overlay covers the lower part of the video, so its empty areas must start drags too.
const DRAG_SURFACE = "video, .controls, .controls-row, .group, .time";

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export function classifyDrag(dx, dy, startFraction) {
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return null;
  if (Math.abs(dx) > Math.abs(dy)) return "seek";
  return startFraction < 0.5 ? "brightness" : "volume";
}

// `change` is the drag as a fraction of the full range; steps of 5% land exactly on 100%.
export function stepLevel(start, change, min, max) {
  return clamp(Math.round((start + change * (max - min)) * 20) / 20, min, max);
}

export function seekTarget(time, duration, change) {
  return clamp(time + Math.round(change * SEEK_SECONDS_PER_WIDTH), 0, duration);
}

// iOS keeps media volume under the hardware buttons and ignores writes.
function canSetVolume() {
  const probe = document.createElement("audio");
  probe.volume = 0.5;
  return probe.volume === 0.5;
}

export function initGestures({ stage, video, controls }) {
  if (!matchMedia("(pointer: coarse)").matches) return;

  const hud = document.getElementById("gestureHud");
  const volumeAdjustable = canSetVolume();
  let drag = null;
  let dragEndedAt = -Infinity;

  let brightness = load("brightness", 1);
  const applyBrightness = () => {
    video.style.filter = brightness === 1 ? "" : `brightness(${brightness})`;
  };
  applyBrightness();

  const showHud = (name, text) => {
    hud.innerHTML = `${icon(name)}<span>${text}</span>`;
    hud.classList.add("show");
  };

  const begin = {
    volume: () => (volumeAdjustable ? controls.volumeLevel() : null),
    brightness: () => brightness,
    seek: () => (Number.isFinite(video.duration) ? video.currentTime : null),
  };

  const update = {
    volume: (dx, dy) => {
      const v = stepLevel(drag.start, -dy / drag.rect.height, 0, 1);
      controls.setVolumeLevel(v);
      showHud(v === 0 ? "volume-x" : "volume", `${Math.round(v * 100)}%`);
    },
    brightness: (dx, dy) => {
      brightness = stepLevel(drag.start, -dy / drag.rect.height, BRIGHTNESS_MIN, BRIGHTNESS_MAX);
      applyBrightness();
      showHud("sun", `${Math.round(brightness * 100)}%`);
    },
    // The seek waits for the finger to lift: seeking on every move stalls big files and floods Watch together.
    seek: (dx) => {
      drag.target = seekTarget(drag.start, video.duration, dx / drag.rect.width);
      const delta = Math.round(drag.target - drag.start);
      const sign = delta < 0 ? "−" : "+";
      showHud(delta < 0 ? "rewind" : "forward", `${sign}${formatTime(Math.abs(delta))} · ${formatTime(drag.target)}`);
    },
  };

  const finish = (commit) => {
    if (drag?.kind) {
      hud.classList.remove("show");
      dragEndedAt = performance.now();
      if (drag.kind === "brightness") save("brightness", brightness);
      if (commit && drag.target !== undefined) video.currentTime = drag.target;
    }
    drag = null;
  };

  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    if (drag) return finish(false); // a second finger means pinch, not drag
    if (!e.target.matches(DRAG_SURFACE)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, kind: null };
  });

  stage.addEventListener("pointermove", (e) => {
    if (e.pointerId !== drag?.id) return;
    if (!drag.kind) {
      const rect = video.getBoundingClientRect();
      const kind = classifyDrag(e.clientX - drag.x, e.clientY - drag.y, (drag.x - rect.left) / rect.width);
      if (!kind) return;
      const start = begin[kind]();
      Object.assign(drag, { kind: start === null ? "ignored" : kind, start, rect, x: e.clientX, y: e.clientY });
    }
    update[drag.kind]?.(e.clientX - drag.x, e.clientY - drag.y);
  });

  stage.addEventListener("pointerup", (e) => e.pointerId === drag?.id && finish(true));
  stage.addEventListener("pointercancel", (e) => e.pointerId === drag?.id && finish(false));

  // A long press would otherwise open the video menu and cancel a slow drag.
  stage.addEventListener("contextmenu", (e) => drag && e.preventDefault());

  stage.addEventListener(
    "click",
    (e) => {
      if (e.target === video && performance.now() - dragEndedAt < CLICK_GUARD_MS) e.stopPropagation();
    },
    true,
  );
}
