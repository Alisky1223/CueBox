import { escapeHtml } from "./format.js";
import { icon } from "./icons.js";
import { closeMenus, toggleMenu } from "./menu.js";

export function initAudioMenu({ button, menu, audio, onSelect, onAddLink }) {
  // Linked tracks play through the sidecar, which browsers with native audioTracks don't use.
  const canAddLink = !audio.native;
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
      .join("")}${
      canAddLink
        ? `<button class="menu-item menu-action" data-action="link">
          <span class="menu-check">${icon("link")}</span><span class="menu-label">Add audio from link…</span>
        </button>`
        : ""
    }`;
    const hidden = !canAddLink && audio.entries.length < 2;
    if (hidden && !menu.hidden) closeMenus();
    button.hidden = hidden;
  };

  menu.addEventListener("click", (e) => {
    const t = e.target.closest("[data-track], [data-action]");
    if (!t) return;
    closeMenus();
    if (t.dataset.action === "link") onAddLink();
    else onSelect(Number(t.dataset.track));
  });

  button.onclick = () => toggleMenu(button, menu);
  audio.onChange(render);
  render();
}
