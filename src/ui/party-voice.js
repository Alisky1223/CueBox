import { MAX_THRESHOLD, MIN_THRESHOLD } from "../party/voice-gate.js";
import { icon, setIcon } from "./icons.js";
import { load, save } from "./storage.js";
import { toast } from "./toast.js";

const MODES = { open: "Open mic", ptt: "Push to talk" };
const MODE_ICONS = { open: "mic", ptt: "hand" };
const KEY = "v";

const micError = (err) =>
  err?.name === "NotAllowedError"
    ? "Microphone access is blocked. Allow it in your browser's site settings."
    : err?.name === "NotFoundError"
      ? "No microphone found."
      : (err?.message ?? "Couldn't turn on the microphone.");

/**
 * Mic button (click to toggle in open mic, hold in push to talk, or the V key), the mode switch in the top bar,
 * the partner-talking badge, and the voice settings shown in the Watch together menu.
 */
export function initPartyVoice({ voice, button, modeSwitch, stage, menu }) {
  voice.mode = MODES[load("voiceMode")] ? load("voiceMode") : "open";
  voice.threshold = load("voiceThreshold", voice.threshold);
  voice.ducking = load("voiceDucking", true);
  voice.setVolume(load("voiceVolume", 1));
  let connected = false;

  const badge = document.createElement("div");
  badge.className = "voice-badge";
  badge.hidden = true;
  badge.innerHTML = `${icon("mic")}<span>Partner is talking</span>`;
  stage.append(badge);

  const toggle = () => {
    if (voice.live) voice.disable();
    else voice.enable().catch((err) => toast(micError(err), { type: "error", duration: 6000 }));
  };
  const talk = (held) => {
    if (held === voice.held) return;
    if (held && !voice.live) voice.enable().catch((err) => toast(micError(err), { type: "error", duration: 6000 }));
    voice.setHeld(held);
  };

  const setMode = (mode) => {
    if (!MODES[mode] || mode === voice.mode) return;
    voice.setMode(mode);
    save("voiceMode", mode);
    update();
    renderSection();
  };

  modeSwitch.innerHTML = Object.entries(MODES)
    .map(
      ([k, v]) =>
        `<button type="button" data-voice-mode="${k}" title="${v}">${icon(MODE_ICONS[k])}<span class="btn-label">${v}</span></button>`,
    )
    .join("");
  modeSwitch.addEventListener("click", (e) => setMode(e.target.closest("[data-voice-mode]")?.dataset.voiceMode));

  function update() {
    for (const b of modeSwitch.children) {
      const on = b.dataset.voiceMode === voice.mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
    }
    modeSwitch.hidden = !connected;
    const ptt = voice.mode === "ptt";
    const on = voice.live && (!ptt || voice.held);
    setIcon(button, on ? "mic" : "mic-off");
    button.classList.toggle("on", on);
    button.classList.toggle("speaking", voice.talking);
    button.title = ptt ? "Hold to talk (V)" : voice.live ? "Turn off microphone (V)" : "Turn on microphone (V)";
    badge.hidden = !connected || !voice.partnerTalking;
    if (!voice.live) meter(voice.level);
  }

  const fill = (db) => Math.min(Math.max((db - MIN_THRESHOLD) / (MAX_THRESHOLD - MIN_THRESHOLD), 0), 1);

  function meter(db) {
    const el = menu.querySelector(".voice-meter");
    if (!el) return;
    el.style.setProperty("--level", fill(db));
    el.classList.toggle("loud", voice.live && db >= voice.threshold);
  }

  const sectionHtml = () => {
    const ptt = voice.mode === "ptt";
    return `<div class="menu-sep"></div>
      <div class="menu-row">
        <span>Voice</span>
        <div class="segmented">${Object.entries(MODES)
          .map(([k, v]) => `<button data-voice-mode="${k}" class="${k === voice.mode ? "on" : ""}">${v}</button>`)
          .join("")}</div>
      </div>
      ${
        ptt
          ? ""
          : `<div class="menu-row">
        <span>Threshold</span>
        <div class="voice-meter" style="--level: ${fill(voice.level)}">
          <input type="range" class="menu-slider" data-voice="threshold" min="${MIN_THRESHOLD}" max="${MAX_THRESHOLD}" step="1" value="${voice.threshold}" aria-label="Voice threshold" />
        </div>
      </div>`
      }
      <div class="menu-row">
        <span>Partner volume</span>
        <input type="range" class="menu-slider" data-voice="volume" min="0" max="1" step="0.05" value="${voice.volume}" aria-label="Partner volume" />
      </div>
      <button class="menu-item${voice.ducking ? " selected" : ""}" data-voice-duck>
        <span class="menu-check">${icon("check")}</span><span class="menu-label">Lower movie while partner talks</span>
      </button>
      <p class="menu-note">${
        ptt
          ? `Hold the mic button or <kbd>V</kbd> to talk.`
          : `Turn on the mic with the mic button or <kbd>V</kbd>. Only sound louder than the threshold (the marker) is sent: speak and set it above your background noise.`
      } Speakers can leak the movie into your mic, so headphones work best.</p>`;
  };

  const renderSection = () => {
    const el = menu.querySelector(".voice-section");
    if (el) el.innerHTML = sectionHtml();
  };

  menu.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-voice-mode]")?.dataset.voiceMode;
    if (mode) return setMode(mode);
    if (e.target.closest("[data-voice-duck]")) {
      voice.ducking = !voice.ducking;
      save("voiceDucking", voice.ducking);
      renderSection();
    }
  });
  menu.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.voice === "threshold") {
      voice.threshold = Number(t.value);
      save("voiceThreshold", voice.threshold);
    } else if (t.dataset.voice === "volume") {
      voice.setVolume(Number(t.value));
      save("voiceVolume", voice.volume);
    }
  });

  button.addEventListener("pointerdown", (e) => {
    voice.resume();
    if (voice.mode !== "ptt" || e.button !== 0) return;
    button.setPointerCapture(e.pointerId);
    talk(true);
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(ev, () => voice.mode === "ptt" && talk(false));
  button.addEventListener("click", () => voice.mode !== "ptt" && toggle());

  document.addEventListener("keydown", (e) => {
    if (!connected || e.key.toLowerCase() !== KEY || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if (e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
    e.preventDefault();
    if (e.repeat) return;
    voice.resume();
    if (voice.mode === "ptt") talk(true);
    else toggle();
  });
  document.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() === KEY && voice.mode === "ptt") talk(false);
  });
  addEventListener("blur", () => voice.mode === "ptt" && talk(false));

  update();
  return {
    update,
    meter,
    /** Voice settings for the menu; they re-render themselves inside this wrapper. */
    section: () => `<div class="voice-section">${sectionHtml()}</div>`,
    setConnected(value) {
      connected = value;
      button.hidden = !value;
      update();
    },
  };
}
