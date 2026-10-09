import { extractMkvTrack, readMkvAudioTracks } from "../mkv/audio.js";

// Beyond MAX_DRIFT the sidecar jumps to the video's time; smaller drifts are eased out by playing slightly faster or slower.
const MAX_DRIFT = 0.25;
const NUDGE_DRIFT = 0.03;
const NUDGE_RATE = 0.05;
const HAVE_FUTURE_DATA = 3;

/** Plays an extracted audio track in a hidden <audio> that follows the video, with the video's own sound silenced. */
class SidecarAudio {
  constructor(video) {
    this.video = video;
    this.audio = null;
    this.url = null;
    this.gain = null;
    const follow = () => this.follow();
    for (const ev of [
      "play",
      "pause",
      "seeking",
      "seeked",
      "ratechange",
      "waiting",
      "playing",
      "volumechange",
      "timeupdate",
      "ended",
    ])
      video.addEventListener(ev, follow);
  }

  // Silencing goes through Web Audio so the video's volume and mute state stay the user's to control.
  // Must first run during a user gesture, or the AudioContext starts suspended.
  prepare() {
    if (!this.gain) {
      const ctx = new AudioContext();
      this.gain = ctx.createGain();
      ctx.createMediaElementSource(this.video).connect(this.gain).connect(ctx.destination);
    }
    this.gain.context.resume().catch(() => {});
  }

  /** Resolves to true once the track is loaded and following the video, or false if aborted; rejects if the browser can't decode it. */
  async attach(blob, signal) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "auto";
    try {
      await new Promise((resolve, reject) => {
        audio.addEventListener("loadedmetadata", resolve, { once: true });
        audio.addEventListener("error", () => reject(new Error("unsupported audio codec")), { once: true });
        audio.src = url;
      });
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    if (signal.aborted) {
      URL.revokeObjectURL(url);
      return false;
    }
    this.detach();
    this.audio = audio;
    this.url = url;
    this.gain.gain.value = 0;
    this.follow();
    return true;
  }

  detach() {
    if (this.gain) this.gain.gain.value = 1;
    if (!this.audio) return;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    URL.revokeObjectURL(this.url);
    this.audio = null;
    this.url = null;
  }

  follow() {
    const { audio, video } = this;
    if (!audio) return;
    audio.volume = video.volume;
    audio.muted = video.muted;
    const drift = audio.currentTime - video.currentTime;
    if (Math.abs(drift) > MAX_DRIFT) audio.currentTime = video.currentTime;
    const nudge = Math.abs(drift) > NUDGE_DRIFT && Math.abs(drift) <= MAX_DRIFT ? -Math.sign(drift) * NUDGE_RATE : 0;
    audio.playbackRate = video.playbackRate * (1 + nudge);
    const playing = !video.paused && !video.seeking && video.readyState >= HAVE_FUTURE_DATA;
    if (playing && audio.paused) audio.play().catch(() => {});
    else if (!playing && !audio.paused) audio.pause();
  }
}

/**
 * Lists a video's audio tracks and switches between them. Uses `video.audioTracks` where the browser has it;
 * otherwise reads MKV/WebM tracks itself and plays non-default ones through a synced sidecar <audio>.
 */
export class AudioTracks {
  constructor(video) {
    this.video = video;
    this.entries = [];
    this.active = -1;
    this.pending = -1;
    this.listeners = new Set();
    this.native = Boolean(video.audioTracks);
    if (this.native) {
      for (const ev of ["addtrack", "removetrack", "change"])
        video.audioTracks.addEventListener(ev, () => this.syncNative());
    } else {
      this.sidecar = new SidecarAudio(video);
      this.file = null;
      this.cache = new Map();
      this.extraction = null;
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  syncNative() {
    const list = [...this.video.audioTracks];
    this.entries = list.map((t, i) => ({ label: t.label || t.language || `Track ${i + 1}`, language: t.language }));
    this.active = list.findIndex((t) => t.enabled);
    this.emit();
  }

  reset() {
    if (this.native) return;
    this.extraction?.abort();
    this.sidecar.detach();
    this.cache.clear();
    this.file = null;
    this.entries = [];
    this.active = -1;
    this.pending = -1;
    this.emit();
  }

  async loadMkv(file) {
    if (this.native) return;
    this.file = file;
    const tracks = await readMkvAudioTracks(file);
    if (this.file !== file || !tracks) return;
    this.entries = tracks;
    // Without audioTracks support, browsers play the first audio track in the file.
    this.active = tracks.length ? 0 : -1;
    this.emit();
  }

  /**
   * Switches to the track at `index`. Resolves to false if superseded by another switch or a new video.
   * @param {number} index
   * @param {{onProgress?: (fraction: number) => void}} [options] called while a track is being extracted
   */
  async select(index, { onProgress } = {}) {
    if (!this.entries[index]) return false;
    if (this.native) {
      [...this.video.audioTracks].forEach((t, i) => (t.enabled = i === index));
      return true;
    }
    if (index === this.active && this.pending < 0) return true;

    this.extraction?.abort();
    this.pending = -1;
    if (index === 0) {
      this.sidecar.detach();
      this.active = 0;
      this.emit();
      return true;
    }

    this.sidecar.prepare();
    const controller = (this.extraction = new AbortController());
    const { signal } = controller;
    this.pending = index;
    this.emit();
    try {
      let blob = this.cache.get(index);
      if (!blob) {
        blob = await extractMkvTrack(this.file, this.entries[index].number, { signal, onProgress });
        if (signal.aborted) return false;
        if (!blob) throw new Error("track not found");
        this.cache.set(index, blob);
      }
      if (!(await this.sidecar.attach(blob, signal))) return false;
      this.active = index;
      return true;
    } catch (err) {
      if (signal.aborted) return false;
      throw err;
    } finally {
      if (this.extraction === controller) {
        this.extraction = null;
        this.pending = -1;
        this.emit();
      }
    }
  }

  /** Next track, wrapping around; null when there is nothing to switch to. */
  next() {
    if (this.entries.length < 2) return null;
    const from = this.pending >= 0 ? this.pending : this.active;
    return (from + 1) % this.entries.length;
  }
}
