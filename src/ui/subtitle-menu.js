import { escapeHtml, formatDelay } from "./format.js";
import { icon } from "./icons.js";
import { closeMenus, toggleMenu } from "./menu.js";
import { load, save } from "./storage.js";

const SIZES = { S: 80, M: 100, L: 125, XL: 155 };
const BACKGROUNDS = { shadow: "Shadow", box: "Box" };
export const DELAY_STEP = 0.1;

export function initSubtitleMenu({ button, menu, subs, onAddFile }) {
  const style = { size: load("subSize", "M"), background: load("subBackground", "shadow") };
  const styleEl = document.createElement("style");
  document.head.append(styleEl);

  const applyStyle = () => {
    const box = style.background === "box";
    styleEl.textContent = `video::cue {
      font-size: ${SIZES[style.size] ?? 100}%;
      color: #fff;
      background: ${box ? "rgba(0, 0, 0, 0.72)" : "transparent"};
      text-shadow: ${box ? "none" : "0 0 4px #000, 0 2px 3px #000, 0 0 1px #000"};
    }`;
    save("subSize", style.size);
    save("subBackground", style.background);
  };

  const render = () => {
    const tracks = subs.entries
      .map((e, i) => {
        const tag = e.supported ? (e.source === "file" ? "File" : "Embedded") : "Image · unsupported";
        return `<button class="menu-item${i === subs.active ? " selected" : ""}" data-track="${i}" ${e.supported ? "" : "disabled"}>
          <span class="menu-check">${icon("check")}</span>
          <span class="menu-label">${escapeHtml(e.label)}</span>
          <span class="menu-tag">${tag}</span>
        </button>`;
      })
      .join("");

    menu.innerHTML = `
      <div class="menu-title">Subtitles</div>
      <button class="menu-item${subs.active < 0 ? " selected" : ""}" data-track="-1">
        <span class="menu-check">${icon("check")}</span><span class="menu-label">Off</span>
      </button>
      ${tracks}
      <button class="menu-item menu-action" data-action="add">
        <span class="menu-check">${icon("plus")}</span><span class="menu-label">Add subtitle file…</span>
      </button>
      <div class="menu-sep"></div>
      <div class="menu-row">
        <span>Size</span>
        <div class="segmented">${Object.keys(SIZES)
          .map((k) => `<button data-size="${k}" class="${k === style.size ? "on" : ""}">${k}</button>`)
          .join("")}</div>
      </div>
      <div class="menu-row">
        <span>Background</span>
        <div class="segmented">${Object.entries(BACKGROUNDS)
          .map(([k, v]) => `<button data-bg="${k}" class="${k === style.background ? "on" : ""}">${v}</button>`)
          .join("")}</div>
      </div>
      <div class="menu-row">
        <span>Delay</span>
        <div class="stepper">
          <button data-delay="-1" title="Earlier (G)">${icon("minus")}</button>
          <output>${formatDelay(subs.delay)}</output>
          <button data-delay="1" title="Later (H)">${icon("plus")}</button>
          <button data-delay="0" title="Reset" ${subs.delay ? "" : "disabled"}>${icon("reset")}</button>
        </div>
      </div>`;
    button.classList.toggle("on", subs.active >= 0);
  };

  menu.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || t.disabled) return;
    if (t.dataset.track !== undefined) {
      subs.select(Number(t.dataset.track));
      closeMenus();
    } else if (t.dataset.action === "add") {
      closeMenus();
      onAddFile();
    } else if (t.dataset.size) {
      style.size = t.dataset.size;
      applyStyle();
      render();
    } else if (t.dataset.bg) {
      style.background = t.dataset.bg;
      applyStyle();
      render();
    } else if (t.dataset.delay !== undefined) {
      const dir = Number(t.dataset.delay);
      subs.setDelay(dir ? subs.delay + dir * DELAY_STEP : 0);
    }
  });

  button.onclick = () => toggleMenu(button, menu);
  subs.onChange(render);
  applyStyle();
  render();
}
