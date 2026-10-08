import { icon } from "./icons.js";

const container = () => document.getElementById("toasts");

const ICON = { error: "alert", success: "check", info: "info" };

function create(message, type) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icon(ICON[type])}</span><div class="toast-body"><div class="toast-text"></div></div>`;
  el.querySelector(".toast-text").textContent = message;
  container().append(el);
  return el;
}

function dismiss(el, delay) {
  setTimeout(() => {
    el.classList.add("leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, delay);
}

export function toast(message, { type = "info", duration = 3500 } = {}) {
  dismiss(create(message, type), duration);
}

export function progressToast(message) {
  const el = create(message, "info");
  const bar = document.createElement("div");
  bar.className = "toast-progress";
  bar.innerHTML = "<span></span>";
  el.querySelector(".toast-body").append(bar);
  const text = el.querySelector(".toast-text");
  let closed = false;
  return {
    update(fraction, label) {
      bar.firstChild.style.width = `${Math.round(fraction * 100)}%`;
      if (label) text.textContent = label;
    },
    close(label, type = "success") {
      if (closed) return;
      closed = true;
      if (!label) return dismiss(el, 0);
      el.className = `toast toast-${type}`;
      el.querySelector(".toast-icon").innerHTML = icon(ICON[type]);
      text.textContent = label;
      bar.remove();
      dismiss(el, 3500);
    },
  };
}
