import { MAX_NAME, MAX_TEXT, REACTIONS, chatMessage, cleanName, reactionMessage } from "../party/chat.js";
import { escapeHtml } from "./format.js";
import { icon } from "./icons.js";
import { load, save } from "./storage.js";

const BUBBLE_MS = 5000;
const MAX_BUBBLES = 3;
const MAX_LOG = 200;
// A partner spamming reactions shouldn't bury the video.
const MAX_FLOATING = 12;

/** Chat panel and on-video bubbles/reactions for Watch together; messages go out through `send`. */
export function initPartyChat({ stage, button, panel, send }) {
  let name = cleanName(load("partyName", ""));
  let unread = 0;

  panel.innerHTML = `
    <div class="chat-head">
      <span class="chat-title">Chat</span>
      <input class="chat-name" placeholder="Your name" value="${escapeHtml(name)}" maxlength="${MAX_NAME}" autocomplete="nickname" spellcheck="false" aria-label="Your name" />
      <button class="icon-btn" type="button" data-close title="Close chat">${icon("x")}</button>
    </div>
    <div class="chat-log" aria-live="polite"><p class="chat-empty">Say hi to your partner.</p></div>
    <div class="chat-reactions">${REACTIONS.map((e) => `<button type="button" data-emoji="${e}" title="React ${e}">${e}</button>`).join("")}</div>
    <form class="chat-form">
      <input name="text" placeholder="Message" maxlength="${MAX_TEXT}" autocomplete="off" aria-label="Message" />
      <button class="icon-btn" type="submit" title="Send">${icon("send")}</button>
    </form>`;
  const log = panel.querySelector(".chat-log");
  const empty = log.querySelector(".chat-empty");
  const nameInput = panel.querySelector(".chat-name");
  const form = panel.querySelector(".chat-form");

  const bubbles = document.createElement("div");
  bubbles.className = "chat-bubbles";
  const floats = document.createElement("div");
  floats.className = "chat-floats";
  stage.append(bubbles, floats);

  const isOpen = () => !panel.hidden;

  function setOpen(open) {
    panel.hidden = !open;
    button.classList.toggle("active", open);
    if (!open) return;
    setUnread(0);
    bubbles.replaceChildren();
    log.scrollTop = log.scrollHeight;
    form.elements.text.focus();
  }

  function setUnread(n) {
    unread = n;
    button.classList.toggle("unread", n > 0);
    button.title = n ? `Chat · ${n} new` : "Chat";
  }

  function addLine({ mine, name: who, text, emoji }) {
    empty.remove();
    const line = document.createElement("div");
    line.className = `chat-line${mine ? " mine" : ""}${emoji ? " reaction" : ""}`;
    line.innerHTML = `<span class="chat-who"></span><span class="chat-text"></span>`;
    line.firstChild.textContent = mine ? "You" : who || "Partner";
    line.lastChild.textContent = emoji ?? text;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    log.append(line);
    while (log.children.length > MAX_LOG) log.firstChild.remove();
    if (atBottom || mine) log.scrollTop = log.scrollHeight;
  }

  function showBubble(who, text) {
    const el = document.createElement("div");
    el.className = "chat-bubble";
    el.innerHTML = `<span class="chat-who"></span><span class="chat-text"></span>`;
    el.firstChild.textContent = who || "Partner";
    el.lastChild.textContent = text;
    bubbles.append(el);
    while (bubbles.children.length > MAX_BUBBLES) bubbles.firstChild.remove();
    setTimeout(() => {
      el.classList.add("leaving");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, BUBBLE_MS);
  }

  function floatEmoji(emoji) {
    if (floats.children.length >= MAX_FLOATING) return;
    const el = document.createElement("span");
    el.className = "chat-float";
    el.textContent = emoji;
    el.style.left = `${10 + Math.random() * 80}%`;
    el.addEventListener("animationend", () => el.remove(), { once: true });
    floats.append(el);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = chatMessage(form.elements.text.value, name);
    if (!msg) return;
    send(msg);
    addLine({ mine: true, text: msg.text });
    form.elements.text.value = "";
  });
  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return setOpen(false);
    const emoji = e.target.closest("[data-emoji]")?.dataset.emoji;
    const msg = emoji && reactionMessage(emoji, name);
    if (!msg) return;
    send(msg);
    addLine({ mine: true, emoji });
    floatEmoji(emoji);
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    setOpen(false);
    button.focus();
  });
  nameInput.addEventListener("change", () => {
    name = cleanName(nameInput.value);
    nameInput.value = name;
    save("partyName", name);
  });
  button.onclick = () => setOpen(!isOpen());

  return {
    setConnected(connected) {
      button.hidden = !connected;
      if (!connected) setOpen(false);
    },
    /** Shows a validated incoming message (see readChat). */
    receive(incoming) {
      if (incoming.kind === "react") floatEmoji(incoming.emoji);
      else if (!isOpen()) showBubble(incoming.name, incoming.text);
      addLine({ mine: false, name: incoming.name, text: incoming.text, emoji: incoming.emoji });
      if (!isOpen()) setUnread(unread + 1);
    },
    reset() {
      log.replaceChildren(empty);
      bubbles.replaceChildren();
      setUnread(0);
    },
  };
}
