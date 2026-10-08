const SPEAKER = '<path d="M11 5 6 9H2v6h4l5 4z"/>';

const ICONS = {
  logo: '<rect x="1" y="2" width="22" height="20" rx="6" fill="currentColor" stroke="none"/><path d="M10 7v7l5.5-3.5z" fill="#111" stroke="none"/><path d="M7 18h10" stroke="#111"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
  pause:
    '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  back10:
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><text x="12.5" y="15.5" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">10</text>',
  fwd10:
    '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><text x="11.5" y="15.5" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">10</text>',
  volume: `${SPEAKER}<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>`,
  "volume-low": `${SPEAKER}<path d="M15.5 8.5a5 5 0 0 1 0 7"/>`,
  "volume-x": `${SPEAKER}<path d="m22 9-6 6M16 9l6 6"/>`,
  captions: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
  maximize:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize:
    '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
  pip: '<rect x="2" y="4" width="20" height="16" rx="3"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor"/>',
  folder:
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

export function setIcon(el, name) {
  el.dataset.icon = name;
  el.innerHTML = icon(name);
}

export function renderIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon);
}
