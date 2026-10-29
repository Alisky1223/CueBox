export const MAX_TEXT = 500;
export const MAX_NAME = 24;
export const REACTIONS = ["👍", "😂", "😮", "😢", "❤️", "🔥"];

export const cleanName = (name) =>
  typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";

export function chatMessage(text, name) {
  const clean = typeof text === "string" ? text.trim().slice(0, MAX_TEXT) : "";
  return clean ? { t: "chat", text: clean, name: cleanName(name) } : null;
}

export function reactionMessage(emoji, name) {
  return REACTIONS.includes(emoji) ? { t: "react", emoji, name: cleanName(name) } : null;
}

/** Validates a partner's chat or reaction message; anything else (sync traffic, junk) gives null. */
export function readChat(msg) {
  if (msg?.t === "chat") {
    const valid = chatMessage(msg.text, msg.name);
    return valid && { kind: "text", text: valid.text, name: valid.name };
  }
  if (msg?.t === "react") {
    const valid = reactionMessage(msg.emoji, msg.name);
    return valid && { kind: "react", emoji: valid.emoji, name: valid.name };
  }
  return null;
}
