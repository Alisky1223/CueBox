import { Peer } from "peerjs";
import { makeCode } from "./code.js";

// Namespaces our codes on the shared public PeerJS server.
const PREFIX = "cuebox-";
const JOIN_TIMEOUT_MS = 20000;
const RECONNECT_MS = 3000;

const MESSAGES = {
  "peer-unavailable": "No one is waiting with that code. Check it and try again.",
  network: "Can't reach the pairing server. Check your internet connection.",
  "server-error": "The pairing server isn't responding. Try again in a moment.",
  "socket-error": "Can't reach the pairing server. Check your internet connection.",
  "browser-incompatible": "This browser doesn't support Watch together.",
  webrtc: "Couldn't connect to your partner. Your network may be blocking it.",
};

export function describeError(err) {
  return MESSAGES[err?.type] ?? err?.message ?? "Connection failed.";
}

/**
 * One-to-one link through the public PeerJS server: the host waits under a short code, the guest connects to it.
 * Only small JSON messages travel over it.
 */
export class PartyLink {
  /**
   * @param {object} handlers
   * @param {() => void} handlers.onOpen partner connected
   * @param {(msg: object) => void} handlers.onMessage
   * @param {() => void} handlers.onClose partner left or connection dropped
   * @param {(err: Error) => void} handlers.onError error after setup
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
      // Only one partner at a time; a returning partner replaces a dropped connection.
      if (this.connected) return conn.on("open", () => conn.close());
      this.attach(conn);
    });
    return this.code;
  }

  /** Resolves once connected to the host waiting under `code`. */
  async join(code) {
    await this.openPeer();
    const peer = this.peer;
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
    this.code = code;
    await new Promise((resolve, reject) => {
      const fail = (err) => {
        clearTimeout(timer);
        conn.off("open", done);
        this.leave();
        reject(err);
      };
      const done = () => {
        clearTimeout(timer);
        peer.off("error", fail);
        resolve();
      };
      const timer = setTimeout(
        () => fail(Object.assign(new Error(MESSAGES.webrtc), { type: "webrtc" })),
        JOIN_TIMEOUT_MS,
      );
      peer.once("error", fail);
      conn.once("open", done);
      this.attach(conn);
    });
  }

  send(msg) {
    if (this.connected) this.conn.send(msg);
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

  attach(conn) {
    this.conn = conn;
    conn.on("open", () => {
      if (this.conn === conn) this.handlers.onOpen();
    });
    conn.on("data", (msg) => {
      if (this.conn === conn) this.handlers.onMessage(msg);
    });
    conn.on("close", () => {
      if (this.conn !== conn) return;
      this.conn = null;
      this.handlers.onClose();
    });
  }
}
