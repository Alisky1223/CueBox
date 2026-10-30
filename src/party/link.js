import { Peer } from "peerjs";
import { makeCode } from "./code.js";

// Namespaces our codes on the shared public PeerJS server.
const PREFIX = "cuebox-";
const JOIN_TIMEOUT_MS = 20000;
const RECONNECT_MS = 3000;
// Gives the "full" notice time to arrive before the connection closes.
const FULL_CLOSE_MS = 1000;

const MESSAGES = {
  full: "This code is already in use by two people.",
  "peer-unavailable": "No one is waiting with that code. Check it and try again.",
  network: "Can't reach the pairing server. Check your internet connection.",
  "server-error": "The pairing server isn't responding. Try again in a moment.",
  "socket-error": "Can't reach the pairing server. Check your internet connection.",
  "browser-incompatible": "This browser doesn't support Watch together.",
  webrtc: "Couldn't connect to your partner. Your network may be blocking it.",
};

const linkError = (type) => Object.assign(new Error(MESSAGES[type]), { type });

export function describeError(err) {
  return MESSAGES[err?.type] ?? err?.message ?? "Connection failed.";
}

/**
 * One-to-one link through the public PeerJS server: the host waits under a short code, the guest connects to it.
 * Small JSON messages travel over a data connection; voice goes over a separate media call.
 */
export class PartyLink {
  /**
   * @param {object} handlers
   * @param {() => void} handlers.onOpen partner connected
   * @param {(msg: object) => void} handlers.onMessage
   * @param {() => void} handlers.onClose partner left or connection dropped
   * @param {(err: Error) => void} handlers.onError error after setup
   * @param {(call: import("peerjs").MediaConnection) => void} handlers.onCall partner started a voice call, not yet answered
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.peer = null;
    this.conn = null;
    this.code = null;
  }

  get connected() {
    return Boolean(this.conn?.open);
  }

  /** Registers a fresh code and waits for a partner; resolves with the code. */
  async host() {
    for (let attempt = 0; ; attempt++) {
      const code = makeCode();
      try {
        await this.openPeer(PREFIX + code);
        this.code = code;
        break;
      } catch (err) {
        if (err.type !== "unavailable-id" || attempt >= 2) throw err;
      }
    }
    this.peer.on("connection", (conn) => {
      // Two people per party: a joining or joined partner holds the spot until they drop, then it's free for a rejoin.
      if (this.conn) {
        conn.once("open", () => {
          conn.send({ t: "full" });
          setTimeout(() => conn.close(), FULL_CLOSE_MS);
        });
        return;
      }
      // Registered before attach() so the welcome goes out ahead of the session's first messages.
      conn.once("open", () => conn.send({ t: "welcome" }));
      this.attach(conn, { awaitWelcome: false });
      setTimeout(() => {
        if (this.conn !== conn || conn.open) return;
        this.conn = null;
        conn.close();
      }, JOIN_TIMEOUT_MS);
    });
    return this.code;
  }

  /** Resolves once the host waiting under `code` has let us in. */
  async join(code) {
    await this.openPeer();
    const peer = this.peer;
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
    this.code = code;
    await new Promise((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer);
        peer.off("error", fail);
        conn.off("data", onData);
      };
      const fail = (err) => {
        settle();
        this.leave();
        reject(err);
      };
      const onData = (msg) => {
        if (msg?.t === "full") return fail(linkError("full"));
        if (msg?.t !== "welcome") return;
        settle();
        resolve();
      };
      const timer = setTimeout(() => fail(linkError("webrtc")), JOIN_TIMEOUT_MS);
      peer.once("error", fail);
      this.attach(conn, { awaitWelcome: true });
      conn.on("data", onData);
    });
  }

  send(msg) {
    if (this.connected) this.conn.send(msg);
  }

  /** Starts a voice call to the partner, sending `stream`. */
  call(stream) {
    return this.connected ? this.peer.call(this.conn.peer, stream) : null;
  }

  leave() {
    const { peer, conn } = this;
    this.peer = this.conn = this.code = null;
    conn?.close();
    peer?.destroy();
  }

  openPeer(id) {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      const fail = (err) => {
        peer.destroy();
        reject(err);
      };
      peer.once("error", fail);
      peer.once("open", () => {
        peer.off("error", fail);
        this.peer = peer;
        peer.on("error", (err) => {
          if (this.peer === peer) this.handlers.onError(err);
        });
        peer.on("call", (call) => {
          if (this.peer === peer && this.connected && call.peer === this.conn.peer) this.handlers.onCall(call);
          else call.close();
        });
        // Losing the pairing server keeps the open data connection; reconnecting lets a dropped partner rejoin.
        peer.on("disconnected", () => {
          setTimeout(() => {
            if (this.peer === peer && !peer.destroyed && peer.disconnected) peer.reconnect();
          }, RECONNECT_MS);
        });
        resolve();
      });
    });
  }

  /** The guest counts as connected only once the host welcomes it, since a full party turns it away after connecting. */
  attach(conn, { awaitWelcome }) {
    this.conn = conn;
    conn.on("open", () => {
      if (this.conn === conn && !awaitWelcome) this.handlers.onOpen();
    });
    conn.on("data", (msg) => {
      if (this.conn !== conn) return;
      if (msg?.t === "welcome") this.handlers.onOpen();
      else if (msg?.t !== "full") this.handlers.onMessage(msg);
    });
    conn.on("close", () => {
      if (this.conn !== conn) return;
      this.conn = null;
      this.handlers.onClose();
    });
  }
}
