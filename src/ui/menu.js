const open = new Map();

export function isMenuOpen() {
  return open.size > 0;
}

export function closeMenus() {
  for (const [menu, button] of open) {
    menu.hidden = true;
    button.classList.remove("active");
  }
  open.clear();
}

export function toggleMenu(button, menu) {
  const wasOpen = open.has(menu);
  closeMenus();
  if (wasOpen) return;
  menu.hidden = false;
  const parent = menu.offsetParent.getBoundingClientRect();
  const anchor = button.getBoundingClientRect();
  const right = Math.min(parent.right - anchor.right - 8, parent.width - menu.offsetWidth - 12);
  menu.style.right = `${Math.max(12, right)}px`;
  button.classList.add("active");
  open.set(menu, button);
}

document.addEventListener("pointerdown", (e) => {
  for (const [menu, button] of open) if (menu.contains(e.target) || button.contains(e.target)) return;
  closeMenus();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenus());
