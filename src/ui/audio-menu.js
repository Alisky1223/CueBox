import { escapeHtml } from "./format.js";
import { icon } from "./icons.js";
import { closeMenus, toggleMenu } from "./menu.js";

export function initAudioMenu({ button, menu, audio, onSelect }) {
  const render = () => {
    menu.innerHTML = `<div class="menu-title">Audio</div>${audio.entries
      .map((e, i) => {
        const tag = i === audio.pending ? "Loading…" : e.codec;
        return `<button class="menu-item${i === audio.active ? " selected" : ""}" data-track="${i}">
          <span class="menu-check">${icon("check")}</span>
          <span class="menu-label">${escapeHtml(e.label)}</span>
          ${tag ? `<span class="menu-tag">${escapeHtml(tag)}</span>` : ""}
        </button>`;
      })
      .join("")}`;
    const hidden = audio.entries.length < 2;
    if (hidden && !menu.hidden) closeMenus();
    button.hidden = hidden;
  };

  menu.addEventListener("click", (e) => {
    const t = e.target.closest("[data-track]");
    if (!t) return;
    closeMenus();
    onSelect(Number(t.dataset.track));
  });

  button.onclick = () => toggleMenu(button, menu);
  audio.onChange(render);
  render();
}
