// Few servers on purpose: every extra one slows candidate gathering.
const STUN = { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] };
// PeerJS's free relay. `turn:` alone means UDP only; the TCP variants get through networks that block UDP.
const PEERJS_TURN = {
  urls: [
    "turn:eu-0.turn.peerjs.com:3478?transport=udp",
    "turn:eu-0.turn.peerjs.com:3478?transport=tcp",
    "turn:us-0.turn.peerjs.com:3478?transport=udp",
    "turn:us-0.turn.peerjs.com:3478?transport=tcp",
  ],
  username: "peerjs",
  credential: "peerjsp",
};

const ICE_URL = /^(stun|turns?):[^\s]+$/i;

/**
 * Validates a user-entered relay server. `urls` may hold several URLs split by spaces or commas.
 * @returns {RTCIceServer | null | undefined} null when empty, undefined when invalid
 */
export function customIceServer(server) {
  const { urls = "", username = "", credential = "" } = server ?? {};
  const list = urls.split(/[\s,]+/).filter(Boolean);
  if (!list.length) return null;
  if (!list.every((u) => ICE_URL.test(u))) return undefined;
  const own = { urls: list };
  if (username) own.username = username;
  if (credential) own.credential = credential;
  return own;
}

/** The user's own server goes first so it's tried alongside the free ones, not after them. */
export function iceServers(custom) {
  const own = customIceServer(custom);
  return own ? [own, STUN, PEERJS_TURN] : [STUN, PEERJS_TURN];
}

export const VOICE_KBPS = 24;

/** Caps Opus bitrate and turns on its loss recovery, so voice stays clear on a slow or lossy link. */
export function limitVoice(sdp, kbps = VOICE_KBPS) {
  const pt = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!pt) return sdp;
  const params = { maxaveragebitrate: String(kbps * 1000), useinbandfec: "1" };
  const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, "m");
  if (!fmtp.test(sdp)) {
    const line = `a=fmtp:${pt} ${Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(";")}`;
    return sdp.replace(new RegExp(`^(a=rtpmap:${pt} .*)$`, "m"), `$1\r\n${line}`);
  }
  return sdp.replace(fmtp, (_, rest) => {
    const merged = new Map(rest.split(";").map((p) => p.trim().split("=")));
    for (const [k, v] of Object.entries(params)) merged.set(k, v);
    return `a=fmtp:${pt} ${[...merged].map(([k, v]) => `${k}=${v}`).join(";")}`;
  });
}

export const FREE_RELAY = "free";

/** Saved relay servers and which one is in use; an old single relay setting becomes the first saved one. */
export function readRelays(saved, legacy) {
  if (Array.isArray(saved?.list)) {
    const list = saved.list.filter((r) => r?.id);
    return { active: list.some((r) => r.id === saved.active) ? saved.active : FREE_RELAY, list };
  }
  if (legacy?.urls) {
    const relay = {
      id: "r1",
      name: "My relay",
      urls: legacy.urls,
      username: legacy.username ?? "",
      credential: legacy.credential ?? "",
    };
    return { active: relay.id, list: [relay] };
  }
  return { active: FREE_RELAY, list: [] };
}

export const activeRelay = (relays) => relays.list.find((r) => r.id === relays.active) ?? null;
