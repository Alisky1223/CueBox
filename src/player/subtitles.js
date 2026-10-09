import { toCueText } from "../subtitles/parsers.js";

/** Owns the subtitle text tracks of one <video>: listing, selection and delay. */
export class SubtitleManager {
  constructor(video) {
    this.video = video;
    this.entries = [];
    this.active = -1;
    this.delay = 0;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  // Text tracks cannot be removed from a <video>, so old ones are disabled and forgotten.
  reset() {
    for (const e of this.entries) if (e.track) e.track.mode = "disabled";
    this.entries = [];
    this.active = -1;
    this.delay = 0;
    this.emit();
  }

  add(label, { language = "", supported = true, source = "embedded" } = {}) {
    const entry = { label, language, supported, source, track: null };
    if (supported) {
      entry.track = this.video.addTextTrack("subtitles", label, language);
      entry.track.mode = "hidden";
    }
    this.entries.push(entry);
    this.emit();
    return entry;
  }

  addCue(entry, start, end, text) {
    if (end <= start) end = start + 3;
    const cue = new VTTCue(start + this.delay, end + this.delay, toCueText(text));
    cue.origStart = start;
    cue.origEnd = end;
    entry.track.addCue(cue);
  }

  select(index) {
    this.active = this.entries[index]?.supported ? index : -1;
    this.entries.forEach((e, i) => {
      if (e.track) e.track.mode = i === this.active ? "showing" : "hidden";
    });
    this.emit();
  }

  /** Off → each usable track → Off. */
  cycle() {
    const usable = this.entries.map((e, i) => (e.supported ? i : -1)).filter((i) => i >= 0);
    const next = usable.find((i) => i > this.active);
    this.select(next ?? -1);
    return this.entries[this.active] ?? null;
  }

  setDelay(seconds) {
    this.delay = Math.round(seconds * 10) / 10;
    for (const e of this.entries) {
      for (const cue of e.track?.cues ?? []) {
        cue.startTime = cue.origStart + this.delay;
        cue.endTime = cue.origEnd + this.delay;
      }
    }
    this.emit();
  }

  get hasUsable() {
    return this.entries.some((e) => e.supported);
  }
}
