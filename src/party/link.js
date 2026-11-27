import { makeCode } from "./code.js";
import { noLog } from "./log.js";
import { isVoicePacket, VOICE_PACKET_BYTES } from "./voice-packet.js";

const JOIN_TIMEOUT_MS = 30000;
const PING_MS = 10000;
const LEFT = 4000;
const LOCAL_RELAY_URL = "ws://127.0.0.1:8787/ws";
const RELAY_URL =
  import.meta.env?.VITE_PARTY_RELAY_URL?.trim() ||
  "wss://cuebox-watch-together.alirezaasadi3saleazzanjan.workers.dev/ws";

const MESSAGES = {
  "room-full": "This code is already in use.",
  "peer-unavailable": "No one is waiting with that code. Check it and try again.",
  "bad-room": "Enter a valid CueBox room code.",
  network: "Can't reach the Watch together relay. Check your internet connection.",
  "local-relay-offline": "Can't reach the local Watch together relay on port 8787. Start it and try again.",
  cancelled: "Connection cancelled.",
};

const linkError = (type) => Object.assign(new Error(MESSAGES[type] ?? MESSAGES.network), { type });

export function describeError(err) {
  return MESSAGES[err?.type] ?? err?.message ?? "Connection failed.";
}

const makeToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** One WebSocket per participant. A session starts when both seats are occupied. */
export class PartyLink {
  constructor(handlers, log = noLog, endpoint = RELAY_URL) {
    this.handlers = handlers;
    this.log = log;
    this.endpoint = endpoint;
    this.socket = null;
    this.code = null;
    this.role = null;
    this.token = null;
    this.peer = false;
    this.voiceRelay = false;
    this.supportsVoiceRelay = false;
    this.peerVoiceRelay = false;
  }

  get connected() {
    return this.peer && this.socket?.readyState === WebSocket.OPEN;
  }

  async host() {
    this.token = makeToken();
    for (let attempt = 0; ; attempt++) {
      try {
        const code = makeCode();
        await this.connect(code, "host");
        return code;
      } catch (err) {
        if (err.type !== "room-full" || attempt >= 2) throw err;
      }
    }
  }

  async join(code) {
    this.token = makeToken();
    await this.connect(code, "guest");
  }

  reconnect() {
    return this.connect(this.code, this.role);
  }

  connect(code, role) {
    const url = new URL(this.endpoint);
    url.searchParams.set("room", code);
    url.searchParams.set("role", role);
    url.searchParams.set("token", this.token);
    if (this.voiceRelay) url.searchParams.set("voice", "relay");

    this.code = code;
    this.role = role;
    const socket = (this.socket = new WebSocket(url));
    socket.binaryType = "arraybuffer";
    this.supportsVoiceRelay = this.peerVoiceRelay = false;
    const networkError = this.endpoint === LOCAL_RELAY_URL ? "local-relay-offline" : "network";
    this.log.add("relay.connecting", { role });

    return new Promise((resolve, reject) => {
      let joined = false;
      let pinger;
      let awaitingPong = false;
      const stop = (type, code) => {
        clearTimeout(timeout);
        clearInterval(pinger);
        if (this.socket !== socket) return;
        this.socket = null;
        this.peer = false;
        this.cancel = null;
        socket.close(code);
        this.log.add("relay.closed", { type });
        if (joined) this.handlers.onDisconnect();
        else reject(linkError(type));
      };

      const timeout = setTimeout(() => stop(networkError), JOIN_TIMEOUT_MS);
      this.cancel = () => {
        clearTimeout(timeout);
        clearInterval(pinger);
        reject(linkError("cancelled"));
      };

      socket.addEventListener("close", () => stop(networkError));
      socket.addEventListener("error", () => stop(networkError));
      socket.addEventListener("message", ({ data }) => {
        if (this.socket !== socket) return;
        if (typeof data !== "string") {
          if (this.relayVoiceReady && isVoicePacket(data)) this.handlers.onVoice?.(data);
          return;
        }
        if (data === "pong") {
          awaitingPong = false;
          return;
        }
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }

        if (!joined) {
          if (event?.type === "rejected") return stop(event.reason);
          if (event?.type !== "joined" || event.player !== (role === "host" ? 1 : 2)) return;
          joined = true;
          this.supportsVoiceRelay = event.voiceRelay === true;
          this.peerVoiceRelay = event.peerVoiceRelay === true;
          clearTimeout(timeout);
          this.log.add("relay.joined", { player: event.player });
          pinger = setInterval(() => {
            if (awaitingPong) return stop(networkError, 4002);
            awaitingPong = true;
            socket.send("ping");
          }, PING_MS);
          resolve();
          if (event.peer === true) this.setPeer(true);
          return;
        }

        if (event?.type === "peer-joined") {
          this.peerVoiceRelay = event.peerVoiceRelay === true;
          this.setPeer(true);
        } else if (event?.type === "peer-left") {
          this.peerVoiceRelay = false;
          this.setPeer(false, event.left === true);
        } else if (event?.type === "app-data" && this.connected && typeof event.payload?.t === "string") {
          this.handlers.onMessage(event.payload);
        }
      });
    });
  }

  setPeer(present, left = false) {
    if (this.peer === present) return;
    this.peer = present;
    if (present) this.handlers.onOpen();
    else this.handlers.onClose({ left });
  }

  send(msg) {
    if (!this.connected) return;
    this.socket.send(JSON.stringify({ type: "app-data", payload: msg }));
  }

  get relayVoiceReady() {
    return this.connected && this.supportsVoiceRelay && this.voiceRelay && this.peerVoiceRelay;
  }

  sendVoice(packet) {
    if (this.relayVoiceReady && this.socket.bufferedAmount < 4 * VOICE_PACKET_BYTES && isVoicePacket(packet)) {
      this.socket.send(packet);
    }
  }

  leave() {
    const socket = this.socket;
    this.socket = this.code = this.role = this.token = null;
    this.peer = false;
    this.cancel?.();
    this.cancel = null;
    socket?.close(LEFT);
  }
}
