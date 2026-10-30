export const MIN_THRESHOLD = -70;
export const MAX_THRESHOLD = -20;
export const DEFAULT_THRESHOLD = -45;
// Keeps the gate open through short pauses, so word endings and gaps between words aren't cut.
export const HOLD_MS = 400;
const SILENCE_DB = -100;

/** RMS level of audio samples (-1…1) in dBFS. */
export function levelDb(samples) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / (samples.length || 1));
  return rms > 0 ? Math.max(20 * Math.log10(rms), SILENCE_DB) : SILENCE_DB;
}

/** Opens when the level goes over `threshold` dB and closes once it has stayed under for `holdMs`. */
export class LevelGate {
  constructor(threshold = DEFAULT_THRESHOLD, holdMs = HOLD_MS) {
    this.threshold = threshold;
    this.holdMs = holdMs;
    this.lastLoud = -Infinity;
  }

  update(db, now) {
    if (db >= this.threshold) this.lastLoud = now;
    return now - this.lastLoud < this.holdMs;
  }

  reset() {
    this.lastLoud = -Infinity;
  }
}

/** Eases `current` toward `target` over a time constant of `tauMs`, for a step of `dtMs`. */
export function approach(current, target, dtMs, tauMs) {
  return target + (current - target) * Math.exp(-dtMs / tauMs);
}
