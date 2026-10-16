// Beyond these drifts a player jumps to its partner's time. Heartbeats tolerate more, since every jump stutters;
// a partner's own action is already a jump, so it's matched closely.
export const SEEK_DRIFT = 0.5;
const ACTION_DRIFT = 0.15;
const PAUSED_DRIFT = 0.05;
export const HEARTBEAT_MS = 2000;
const PING_MS = 5000;
// Local events this soon after applying a remote state are taken as its echo, and heartbeats this soon
// after a local action are stale.
const SETTLE_MS = 2000;
const DURATION_TOLERANCE = 2;

/**
 * @typedef {object} Media
 * @property {boolean} ready  metadata loaded
 * @property {boolean} seeking
 * @property {number} time
 * @property {number} duration
 * @property {boolean} playing
 * @property {number} rate
 * @property {() => void} play
 * @property {() => void} pause
 * @property {(time: number) => void} seek
 * @property {(rate: number) => void} setRate
 */

/**
 * Keeps two players in step over a message channel. Either side can play, pause, seek or change speed;
 * the leader also sends a heartbeat that the follower corrects its drift against.
 */
export class SyncSession {
  /**
   * @param {object} options
   * @param {Media} options.media
   * @param {(msg: object) => void} options.send
   * @param {boolean} options.leader
   * @param {(local: number, remote: number) => void} [options.onMismatch] called when the two videos' lengths differ
   * @param {() => number} [options.now] clock in ms
   */
  constructor({ media, send, leader, onMismatch = () => {}, now = () => Date.now() }) {
    this.media = media;
    this.send = send;
    this.leader = leader;
    this.onMismatch = onMismatch;
    this.now = now;
    this.latency = 0;
    this.remoteDuration = null;
    this.warned = null;
    this.expected = null;
    this.applying = false;
    this.lastLocal = -Infinity;
    this.timers = [];
  }

  start() {
    this.send(this.hello());
    this.ping();
    this.timers = [setInterval(() => this.heartbeat(), HEARTBEAT_MS), setInterval(() => this.ping(), PING_MS)];
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** Call when a new video has loaded its metadata. */
  mediaLoaded() {
    this.expected = null;
    this.send(this.hello());
    this.checkDuration();
    if (this.leader) this.send(this.state("state"));
  }

  /** Call on the video's play, pause, seeked and ratechange events. */
  localChange() {
    if (!this.media.ready || this.isEcho()) return;
    this.lastLocal = this.now();
    this.send(this.state("state"));
  }

  receive(msg) {
    switch (msg?.t) {
      case "hello":
        this.remoteDuration = msg.duration;
        this.checkDuration();
        if (this.leader && this.media.ready) this.send(this.state("state"));
        break;
      case "state":
        this.apply(msg, msg.playing ? ACTION_DRIFT : PAUSED_DRIFT);
        break;
      case "tick":
        if (this.now() - this.lastLocal > SETTLE_MS && !this.media.seeking) this.apply(msg, SEEK_DRIFT);
        break;
      case "ping":
        this.send({ t: "pong", sent: msg.sent });
        break;
      case "pong": {
        const oneWay = Math.max(0, this.now() - msg.sent) / 2;
        this.latency = this.latency ? this.latency * 0.7 + oneWay * 0.3 : oneWay;
        break;
      }
    }
  }

  hello() {
    return { t: "hello", duration: this.media.ready ? this.media.duration : null };
  }

  state(t) {
    const { playing, time, rate } = this.media;
    return { t, playing, time, rate };
  }

  heartbeat() {
    if (this.leader && this.media.ready) this.send(this.state("tick"));
  }

  ping() {
    this.send({ t: "ping", sent: this.now() });
  }

  apply({ playing, time, rate }, maxDrift) {
    const m = this.media;
    if (!m.ready) return;
    const target = Math.min(time + (playing ? (this.latency / 1000) * rate : 0), m.duration);
    this.expected = { playing, time: target, rate, at: this.now() };
    this.applying = true;
    try {
      if (m.rate !== rate) m.setRate(rate);
      if (Math.abs(m.time - target) > maxDrift) m.seek(target);
      if (playing && !m.playing) m.play();
      else if (!playing && m.playing) m.pause();
    } finally {
      this.applying = false;
    }
  }

  isEcho() {
    if (this.applying) return true;
    const e = this.expected;
    if (!e) return false;
    const elapsed = this.now() - e.at;
    if (elapsed > SETTLE_MS) return false;
    const m = this.media;
    const time = e.time + (e.playing ? (elapsed / 1000) * e.rate : 0);
    return m.playing === e.playing && m.rate === e.rate && Math.abs(m.time - time) <= SEEK_DRIFT;
  }

  checkDuration() {
    const local = this.media.ready ? this.media.duration : null;
    const remote = this.remoteDuration;
    if (local == null || remote == null || Math.abs(local - remote) <= DURATION_TOLERANCE) return;
    const key = `${local}/${remote}`;
    if (this.warned === key) return;
    this.warned = key;
    this.onMismatch(local, remote);
  }
}
