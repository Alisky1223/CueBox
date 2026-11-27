import { parseVideoUrl } from "../player/remote-file.js";

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
const MAX_LINK_LENGTH = 8192;

function sharedVideoUrl(input) {
  if (typeof input !== "string" || input.length > MAX_LINK_LENGTH) return null;
  const url = parseVideoUrl(input);
  if (!url || url.length > MAX_LINK_LENGTH) return null;
  const { username, password } = new URL(url);
  return username || password ? null : url;
}

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
   * @param {(url: string) => void} [options.onVideoLink] opens a video shared by the partner
   * @param {() => number} [options.now] clock in ms
   */
  constructor({ media, send, leader, onMismatch = () => {}, onVideoLink = () => {}, now = () => Date.now() }) {
    this.media = media;
    this.send = send;
    this.leader = leader;
    this.onMismatch = onMismatch;
    this.onVideoLink = onVideoLink;
    this.now = now;
    this.latency = 0;
    this.remoteDuration = null;
    this.remoteCanShareVideo = null;
    this.linkVersion = 0;
    this.loadingSharedVideo = false;
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

  get ready() {
    return !this.loadingSharedVideo && this.media.ready && this.remoteDuration !== null;
  }

  /** Call when a new video has loaded its metadata. */
  mediaLoaded() {
    if (!this.media.ready) return;
    this.loadingSharedVideo = false;
    this.expected = null;
    this.send(this.hello());
    this.checkDuration();
    if (this.leader && this.ready) this.send(this.state("state"));
  }

  /** Let the partner know while this viewer opens a different video. */
  mediaUnloaded() {
    this.send(this.hello(null));
  }

  shareVideoLink(input) {
    const url = this.remoteCanShareVideo !== false && sharedVideoUrl(input);
    if (!url) return;
    // Host versions are odd and guest versions are even. The host wins simultaneous selections.
    const linkVersion = 2 * (Math.floor(this.linkVersion / 2) + 1) + Number(this.leader);
    this.beginSharedVideo(linkVersion);
    this.send({ t: "video-link", url, linkVersion });
  }

  beginSharedVideo(linkVersion) {
    this.linkVersion = linkVersion;
    this.loadingSharedVideo = true;
    this.remoteDuration = null;
    this.expected = null;
    this.lastLocal = -Infinity;
  }

  /** Call on the video's play, pause, seeked and ratechange events. */
  localChange() {
    if (!this.ready || this.isEcho()) return;
    this.lastLocal = this.now();
    this.send(this.state("state"));
  }

  receive(msg) {
    switch (msg?.t) {
      case "hello":
        if (msg.duration !== null && (!Number.isFinite(msg.duration) || msg.duration < 0)) return;
        if (this.remoteCanShareVideo === null) {
          this.remoteCanShareVideo = msg.canShareVideo === true;
          if (!this.remoteCanShareVideo && this.linkVersion) {
            this.linkVersion = 0;
            this.loadingSharedVideo = false;
            this.send(this.hello());
          }
        }
        if ((msg.linkVersion ?? 0) !== this.linkVersion) return;
        this.remoteDuration = msg.duration;
        this.checkDuration();
        if (this.leader && this.ready) this.send(this.state("state"));
        break;
      case "video-link": {
        const { linkVersion } = msg;
        if (
          !Number.isSafeInteger(linkVersion) ||
          linkVersion <= this.linkVersion ||
          linkVersion >= Number.MAX_SAFE_INTEGER - 2 ||
          linkVersion % 2 === Number(this.leader)
        )
          return;
        const url = sharedVideoUrl(msg.url);
        if (!url) return;
        this.beginSharedVideo(linkVersion);
        this.onVideoLink(url);
        break;
      }
      case "state":
        if ((msg.linkVersion ?? 0) === this.linkVersion) this.apply(msg, msg.playing ? ACTION_DRIFT : PAUSED_DRIFT);
        break;
      case "tick":
        if (
          (msg.linkVersion ?? 0) === this.linkVersion &&
          this.now() - this.lastLocal > SETTLE_MS &&
          !this.media.seeking
        )
          this.apply(msg, SEEK_DRIFT);
        break;
      case "ping":
        if (!Number.isFinite(msg.sent)) return;
        this.send({ t: "pong", sent: msg.sent });
        break;
      case "pong": {
        const elapsed = this.now() - msg.sent;
        if (!Number.isFinite(msg.sent) || elapsed < 0 || elapsed > 30000) return;
        const oneWay = elapsed / 2;
        this.latency = this.latency ? this.latency * 0.7 + oneWay * 0.3 : oneWay;
        break;
      }
    }
  }

  hello(duration = this.media.ready ? this.media.duration : null) {
    return { t: "hello", duration, canShareVideo: true, linkVersion: this.linkVersion };
  }

  state(t) {
    const { playing, time, rate } = this.media;
    return { t, playing, time, rate, linkVersion: this.linkVersion };
  }

  heartbeat() {
    if (this.leader && this.ready) this.send(this.state("tick"));
  }

  ping() {
    this.send({ t: "ping", sent: this.now() });
  }

  apply({ playing, time, rate }, maxDrift) {
    const m = this.media;
    if (!this.ready) return;
    if (
      typeof playing !== "boolean" ||
      !Number.isFinite(time) ||
      time < 0 ||
      !Number.isFinite(rate) ||
      rate < 0.5 ||
      rate > 2
    )
      return;
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
    if (!this.ready) return;
    const local = this.media.duration;
    const remote = this.remoteDuration;
    if (Math.abs(local - remote) <= DURATION_TOLERANCE) return;
    const key = `${local}/${remote}`;
    if (this.warned === key) return;
    this.warned = key;
    this.onMismatch(local, remote);
  }
}
