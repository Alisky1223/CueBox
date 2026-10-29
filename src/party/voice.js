import { DEFAULT_THRESHOLD, LevelGate, approach, levelDb } from "./voice-gate.js";

// Timers slow down in background tabs, so the gate reacts late there; watching keeps the tab in front.
const TICK_MS = 40;
// The partner's own gate already cuts their background noise, so anything over this is them talking.
const PARTNER_DB = -55;
const DUCK_LEVEL = 0.3;
const DUCK_IN_MS = 120;
const DUCK_OUT_MS = 500;
// Opening fast keeps the first syllable; closing a little slower avoids clicks.
const GATE_OPEN_S = 0.005;
const GATE_CLOSE_S = 0.05;
const CALL_TIMEOUT_MS = 20000;
const SILENT = -100;

const voiceError = (message) => Object.assign(new Error(message), { type: "voice" });

/**
 * Voice chat over a PeerJS media call. The outgoing track comes from Web Audio and stays silent until the mic is on
 * and the gate lets sound through, so the call is set up once on connect and the mic is plugged in later without
 * renegotiating. Open mic sends sound over a threshold; push to talk sends while held.
 */
export class VoiceChat {
  /**
   * @param {object} handlers
   * @param {(voice: VoiceChat) => void} handlers.onChange mic, talking or connection state changed
   * @param {(db: number) => void} handlers.onLevel mic level, every tick while the mic is on
   * @param {(factor: number) => void} handlers.onDuck how much to scale the movie's volume (1 = untouched)
   * @param {(err: Error) => void} handlers.onError
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.mode = "open";
    this.ducking = true;
    this.volume = 1;
    this.held = false;
    this.gate = new LevelGate(DEFAULT_THRESHOLD);
    this.partnerGate = new LevelGate(PARTNER_DB);
    this.ctx = null;
    this.clear();
  }

  clear() {
    this.call = null;
    this.mic = null;
    this.micSource = null;
    this.remote = null;
    this.remoteSource = null;
    this.starting = null;
    this.level = SILENT;
    this.talking = false;
    this.partnerTalking = false;
    this.duck = 1;
  }

  get live() {
    return Boolean(this.mic);
  }

  get connected() {
    return Boolean(this.remote);
  }

  get threshold() {
    return this.gate.threshold;
  }

  set threshold(db) {
    this.gate.threshold = db;
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.player) this.player.volume = volume;
  }

  setMode(mode) {
    this.mode = mode;
    this.held = false;
    this.tick();
  }

  setHeld(held) {
    this.held = held;
    this.tick();
  }

  setup() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.out = ctx.createMediaStreamDestination();
    this.gain.connect(this.out);
    this.micAnalyser = ctx.createAnalyser();
    this.remoteAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = this.remoteAnalyser.fftSize = 1024;
    this.samples = new Float32Array(1024);
    this.player = new Audio();
    this.player.volume = this.volume;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.resume();
  }

  /** Lets audio start; browsers only allow it after the user has interacted with the page. */
  resume() {
    this.ctx?.resume().catch(() => {});
    if (this.player?.srcObject && this.player.paused) this.player.play().catch(() => {});
  }

  /** Calls the partner. Only one side does this; the other answers. */
  start(link) {
    this.setup();
    this.attach(link.call(this.out.stream));
  }

  answer(call) {
    this.setup();
    call.answer(this.out.stream);
    this.attach(call);
  }

  attach(call) {
    if (!call) return;
    this.call?.close();
    this.dropRemote();
    this.call = call;
    call.on("stream", (stream) => this.call === call && this.playRemote(stream));
    call.on("close", () => this.call === call && this.dropRemote());
    call.on("error", () => this.call === call && this.fail());
    setTimeout(() => this.call === call && !this.remote && this.fail(), CALL_TIMEOUT_MS);
  }

  fail() {
    this.handlers.onError(voiceError("Voice chat couldn't connect. Your network may be blocking it."));
  }

  playRemote(stream) {
    if (this.remote === stream) return;
    this.dropRemote();
    this.remote = stream;
    // Chrome only feeds a remote stream into Web Audio while a media element plays it too.
    this.player.srcObject = stream;
    this.player.play().catch(() => {});
    this.remoteSource = this.ctx.createMediaStreamSource(stream);
    this.remoteSource.connect(this.remoteAnalyser);
    this.handlers.onChange(this);
  }

  dropRemote() {
    if (!this.remote) return;
    this.remoteSource.disconnect();
    this.player.srcObject = null;
    this.remote = this.remoteSource = null;
    this.handlers.onChange(this);
  }

  /** Turns the mic on, asking for permission the first time. */
  enable() {
    this.setup();
    this.resume();
    if (this.mic) return Promise.resolve();
    if (!navigator.mediaDevices?.getUserMedia)
      return Promise.reject(voiceError("This browser doesn't allow microphone access here."));
    const ctx = this.ctx;
    this.starting ??= navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((stream) => {
        if (this.ctx !== ctx || this.mic) return stream.getTracks().forEach((t) => t.stop());
        this.mic = stream;
        this.micSource = ctx.createMediaStreamSource(stream);
        this.micSource.connect(this.micAnalyser);
        this.micSource.connect(this.gain);
        stream.getAudioTracks()[0]?.addEventListener("ended", () => this.mic === stream && this.disable());
        this.tick();
        this.handlers.onChange(this);
      })
      .finally(() => {
        if (this.ctx === ctx) this.starting = null;
      });
    return this.starting;
  }

  disable() {
    if (!this.mic) return;
    this.mic.getTracks().forEach((t) => t.stop());
    this.micSource.disconnect();
    this.mic = this.micSource = null;
    this.gate.reset();
    this.tick();
    this.handlers.onChange(this);
  }

  tick() {
    if (!this.ctx) return;
    const now = performance.now();
    let changed = false;

    let talking = false;
    if (this.mic) {
      this.micAnalyser.getFloatTimeDomainData(this.samples);
      this.level = levelDb(this.samples);
      const loud = this.gate.update(this.level, now);
      talking = this.mode === "ptt" ? this.held : loud;
      this.handlers.onLevel(this.level);
    } else this.level = SILENT;
    if (talking !== this.talking) {
      this.talking = talking;
      this.gain.gain.setTargetAtTime(talking ? 1 : 0, this.ctx.currentTime, talking ? GATE_OPEN_S : GATE_CLOSE_S);
      changed = true;
    }

    let partner = false;
    if (this.remoteSource) {
      this.remoteAnalyser.getFloatTimeDomainData(this.samples);
      partner = this.partnerGate.update(levelDb(this.samples), now);
    }
    if (partner !== this.partnerTalking) {
      this.partnerTalking = partner;
      changed = true;
    }

    const target = this.ducking && partner && this.volume > 0 ? DUCK_LEVEL : 1;
    let duck = approach(this.duck, target, TICK_MS, target < this.duck ? DUCK_IN_MS : DUCK_OUT_MS);
    if (Math.abs(duck - target) < 0.01) duck = target;
    if (duck !== this.duck) {
      this.duck = duck;
      this.handlers.onDuck(duck);
    }

    if (changed) this.handlers.onChange(this);
  }

  /** Ends the call and releases the mic; settings are kept for the next session. */
  close() {
    if (!this.ctx) return;
    clearInterval(this.timer);
    const { call, mic, duck } = this;
    mic?.getTracks().forEach((t) => t.stop());
    this.player.srcObject = null;
    this.ctx.close().catch(() => {});
    this.ctx = null;
    this.clear();
    call?.close();
    this.gate.reset();
    this.partnerGate.reset();
    if (duck !== 1) this.handlers.onDuck(1);
    this.handlers.onChange(this);
  }
}
