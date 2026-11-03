import { Peer } from "peerjs";
import { makeCode } from "./code.js";
import { iceServers, limitVoice } from "./net.js";

// Namespaces our codes on the shared public PeerJS server.
const PREFIX = "cuebox-";
// Relayed connections on slow networks can take a while to set up.
const JOIN_TIMEOUT_MS = 30000;
const RECONNECT_MS = 3000;
// Gives the "full" notice time to arrive before the connection closes.
const FULL_CLOSE_MS = 1000;
// Gives the "bye" notice time to go out before the connection closes.
const BYE_CLOSE_MS = 300;
// A connection can stay "open" while no data gets through; silence this long means it's dead.
const PING_MS = 4000;
const STALE_MS = 15000;

const MESSAGES = {
  full: "This code is already in use by two people.",
  "peer-unavailable": "No one is waiting with that code. Check it and try again.",
  network: "Can't reach the pairing server. Check your internet connection.",
  "server-error": "The pairing server isn't responding. Try again in a moment.",
  "socket-error": "Can't reach the pairing server. Check your internet connection.",
  "browser-incompatible": "This browser doesn't support Watch together.",
  webrtc:
    "Couldn't connect to your partner. One of your networks may be blocking it; a relay server under Network settings can help.",
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
   * @param {(info: { left: boolean }) => void} handlers.onClose connection ended; `left` when the partner left on purpose
   * @param {(err: Error) => void} handlers.onError error after setup
   * @param {(call: import("peerjs").MediaConnection) => void} handlers.onCall partner started a voice call, not yet answered
   * @param {() => object} [getIce] the user's own relay server, read whenever a peer is created
   */
  constructor(handlers, getIce = () => null) {
    this.handlers = handlers;
    this.getIce = getIce;
    this.peer = null;
    this.conn = null;
    this.code = null;
    this.token = null;
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
      // The same guest coming back (same token) replaces its old connection, which may not have noticed the drop yet.
      const token = conn.metadata?.token;
      if (this.conn && token && token === this.token) {
        const old = this.conn;
        this.conn = null;
        old.close();
      }
      if (this.conn) {
        conn.once("open", () => {
          conn.send({ t: "full" });
          setTimeout(() => conn.close(), FULL_CLOSE_MS);
        });
        return;
      }
      // Registered before attach() so the welcome goes out ahead of the session's first messages.
      this.token = token ?? null;
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

  /**
   * Resolves once the host waiting under `code` has let us in. Rejoining with the same `token` takes back our spot.
   */
  async join(code, token = makeCode() + makeCode()) {
    // A rejoin keeps the peer if it still reaches the pairing server.
    if (!this.peer || this.peer.destroyed || this.peer.disconnected) {
      this.peer?.destroy();
      await this.openPeer();
    }
    const peer = this.peer;
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json", metadata: { token } });
    this.code = code;
    this.token = token;
    await new Promise((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer);
        peer.off("error", fail);
        conn.off("data", onData);
      };
      const fail = (err) => {
        settle();
        if (this.peer === peer) this.leave();
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
    return this.connected ? this.peer.call(this.conn.peer, stream, { sdpTransform: limitVoice }) : null;
  }

  /** Tells the partner we're leaving on purpose, so they don't wait for us to come back. */
  leave() {
    const { peer, conn } = this;
    this.peer = this.conn = this.code = this.token = null;
    const bye = Boolean(conn?.open);
    if (bye) conn.send({ t: "bye" });
    setTimeout(
      () => {
        conn?.close();
        peer?.destroy();
      },
      bye ? BYE_CLOSE_MS : 0,
    );
  }

  openPeer(id) {
    return new Promise((resolve, reject) => {
      const options = { debug: 0, config: { iceServers: iceServers(this.getIce()) } };
      const peer = id ? new Peer(id, options) : new Peer(options);
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
    let left = false;
    let lastSeen = Date.now();
    let pinger = null;
    conn.on("open", () => {
      lastSeen = Date.now();
      pinger = setInterval(() => {
        if (Date.now() - lastSeen > STALE_MS) return conn.close();
        conn.send({ t: "alive" });
      }, PING_MS);
      if (this.conn === conn && !awaitWelcome) this.handlers.onOpen();
    });
    conn.on("data", (msg) => {
      lastSeen = Date.now();
      if (this.conn !== conn) return;
      const t = msg?.t;
      if (t === "welcome") this.handlers.onOpen();
      else if (t === "bye") left = true;
      else if (t !== "full" && t !== "alive") this.handlers.onMessage(msg);
    });
    conn.on("close", () => {
      clearInterval(pinger);
      if (this.conn !== conn) return;
      this.conn = null;
      this.handlers.onClose({ left });
    });
  }
}
