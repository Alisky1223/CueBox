import { noLog, watchPeerConnection } from "./log.js";
import { customIceServer, iceServers, limitVoice } from "./net.js";
import { DEFAULT_THRESHOLD, LevelGate, approach, levelDb } from "./voice-gate.js";
import { VoiceRelay } from "./voice-relay.js";

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
 * Voice chat starts when either side turns on the mic. Both transports use the same Web Audio gate
 * for open mic and push to talk.
 */
export class VoiceChat {
  /**
   * @param {object} handlers
   * @param {(voice: VoiceChat) => void} handlers.onChange mic, talking or connection state changed
   * @param {(db: number) => void} handlers.onLevel mic level, every tick while the mic is on
   * @param {(factor: number) => void} handlers.onDuck how much to scale the movie's volume (1 = untouched)
   * @param {(err: Error) => void} handlers.onError
   */
  constructor({ getIce = () => null, log = noLog, ...handlers }) {
    this.handlers = handlers;
    this.getIce = getIce;
    this.log = log;
    this.mode = "open";
    this.ducking = true;
    this.volume = 1;
    this.held = false;
    this.gate = new LevelGate(DEFAULT_THRESHOLD);
    this.partnerGate = new LevelGate(PARTNER_DB);
    this.ctx = null;
    this.link = null;
    this.leader = false;
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
    return Boolean(this.remote || this.relay);
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
    if (this.relay) this.relay.output.gain.value = volume;
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

  /** A partner connected; nothing is set up until one of you turns on the mic. */
  open(link, { leader }) {
    this.link = link;
    this.leader = leader;
  }

  async startCall() {
    if (this.call || !this.link || this.callTimer) return;
    if (!this.leader) {
      this.link.send({ t: "rtc-request" });
      this.callTimer = setTimeout(() => this.fail(), CALL_TIMEOUT_MS);
      return;
    }
    const link = this.link;
    let call = this.call;
    try {
      call = this.createCall(crypto.randomUUID());
      await this.sendDescription(call, await call.pc.createOffer());
    } catch (err) {
      if (this.link === link && this.call === call) this.fail(err);
    }
  }

  createCall(id) {
    const ice = this.getIce();
    if (customIceServer(ice) === undefined) {
      throw voiceError("The voice relay URL in Network settings must start with turn:, turns: or stun:.");
    }
    this.setup();
    const pc = new RTCPeerConnection({ iceServers: iceServers(ice) });
    const call = { pc, id, localCandidates: [], remoteCandidates: [] };
    watchPeerConnection(pc, this.log, "voice");
    for (const track of this.out.stream.getAudioTracks()) pc.addTrack(track, this.out.stream);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || this.call !== call) return;
      const msg = { t: "rtc-ice", id, candidate: candidate.toJSON() };
      if (call.localCandidates) call.localCandidates.push(msg);
      else this.link.send(msg);
    };
    pc.ontrack = ({ streams }) => {
      if (this.call === call && streams[0]) this.playRemote(streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (this.call !== call) return;
      if (pc.connectionState === "connected") this.clearCallTimer();
      if (pc.connectionState === "failed") this.fail();
    };
    this.clearCallTimer();
    this.callTimer = setTimeout(() => this.fail(), CALL_TIMEOUT_MS);
    this.call = call;
    return call;
  }

  async sendDescription(call, { type, sdp }) {
    if (this.call !== call) return;
    await call.pc.setLocalDescription({ type, sdp: limitVoice(sdp) });
    if (this.call !== call) return;
    this.link.send({ t: `rtc-${type}`, id: call.id, sdp: call.pc.localDescription.sdp });
    for (const candidate of call.localCandidates) this.link.send(candidate);
    call.localCandidates = null;
  }

  async receiveSignal(msg) {
    if (!this.link || this.link.voiceRelay || this.link.peerVoiceRelay) return;
    if (msg.t === "rtc-request" && this.leader) return this.startCall();
    if (typeof msg.id !== "string") return;

    let call = this.call;
    try {
      if (msg.t === "rtc-offer" && !this.leader && !call && typeof msg.sdp === "string") {
        call = this.createCall(msg.id);
        await this.setRemoteDescription(call, "offer", msg.sdp);
        if (this.call === call) await this.sendDescription(call, await call.pc.createAnswer());
      } else if (call?.id === msg.id) {
        if (msg.t === "rtc-answer" && this.leader && typeof msg.sdp === "string") {
          await this.setRemoteDescription(call, "answer", msg.sdp);
        } else if (msg.t === "rtc-ice" && typeof msg.candidate?.candidate === "string") {
          if (call.pc.remoteDescription) await call.pc.addIceCandidate(msg.candidate);
          else if (call.remoteCandidates.length < 128) call.remoteCandidates.push(msg.candidate);
        } else if (msg.t === "rtc-stop") {
          this.fail(null, false);
        }
      }
    } catch (err) {
      if (this.link && this.call === call) this.fail(err);
    }
  }

  async setRemoteDescription(call, type, sdp) {
    await call.pc.setRemoteDescription({ type, sdp });
    for (const candidate of call.remoteCandidates.splice(0)) {
      if (this.call !== call) return;
      await call.pc.addIceCandidate(candidate);
    }
  }

  clearCallTimer() {
    clearTimeout(this.callTimer);
    this.callTimer = null;
  }

  stopCall() {
    this.clearCallTimer();
    const call = this.call;
    this.call = null;
    call?.pc.close();
    this.relay?.close();
    this.relay = null;
    this.dropRemote();
  }

  fail(err, notify = true) {
    if (notify && this.call) this.link?.send({ t: "rtc-stop", id: this.call.id });
    this.stopCall();
    this.log.add("call.error", { type: err?.type ?? err?.name });
    this.handlers.onError(
      err?.type === "voice" ? err : voiceError("Voice chat couldn't connect. Your network may be blocking it."),
    );
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

  relayAudio() {
    this.setup();
    return (this.relay ??= new VoiceRelay(this.ctx, this.gain, this.remoteAnalyser, this.volume));
  }

  async startRelay() {
    const link = this.link;
    const relay = this.relayAudio();
    const fail = () => {
      if (this.relay !== relay) return;
      this.disable();
      this.fail(voiceError("The browser couldn't start Cloudflare voice capture."));
    };
    try {
      await relay.capture((packet) => {
        if (this.relay === relay && this.mic) link.sendVoice(packet);
      }, fail);
      return relay;
    } catch {
      if (this.relay !== relay) return;
      this.stopCall();
      throw voiceError("The browser couldn't start Cloudflare voice capture.");
    }
  }

  receiveVoice(packet) {
    if (this.link?.relayVoiceReady) this.relayAudio().receive(packet);
  }

  /** Turns the mic on, asking for permission the first time. */
  async enable() {
    const link = this.link;
    if (!link?.connected) return;
    if (link.voiceRelay && !link.supportsVoiceRelay) {
      throw voiceError("This Watch together server needs an update to relay voice.");
    }
    if (link.voiceRelay !== link.peerVoiceRelay) {
      throw voiceError("Choose the same voice connection in Network settings, then join again.");
    }
    this.setup();
    this.resume();
    const ctx = this.ctx;
    let relay;
    if (link.voiceRelay) {
      relay = await this.startRelay();
      if (!relay || this.relay !== relay || !link.relayVoiceReady) return;
    } else void this.startCall();
    if (this.mic) return;
    if (!navigator.mediaDevices?.getUserMedia) throw voiceError("This browser doesn't allow microphone access here.");
    this.starting ??= navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((stream) => {
        if (this.ctx !== ctx || this.mic || (relay && this.relay !== relay)) {
          return stream.getTracks().forEach((t) => t.stop());
        }
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
    if (this.remoteSource || this.relay) {
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
    this.link = null;
    this.stopCall();
    if (!this.ctx) return;
    clearInterval(this.timer);
    const { mic, duck } = this;
    mic?.getTracks().forEach((t) => t.stop());
    this.player.srcObject = null;
    this.ctx.close().catch(() => {});
    this.ctx = null;
    this.clear();
    this.gate.reset();
    this.partnerGate.reset();
    if (duck !== 1) this.handlers.onDuck(1);
    this.handlers.onChange(this);
  }
}
