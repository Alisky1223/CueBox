/* global AudioWorkletProcessor, registerProcessor, sampleRate */

class VoiceCapture extends AudioWorkletProcessor {
  constructor({ processorOptions: { rate, size } }) {
    super();
    this.rate = rate;
    this.size = size;
    this.packet = new Uint8Array(size);
    this.offset = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.audible = false;
  }

  process([[input]]) {
    if (!input) return true;
    for (const sample of input) {
      this.sum += sample;
      this.count++;
      this.phase += this.rate;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      // Average before downsampling, then use μ-law companding to preserve quiet speech.
      const average = Math.max(-1, Math.min(1, this.sum / this.count));
      const magnitude = Math.round((127 * Math.log1p(255 * Math.abs(average))) / Math.log(256));
      const encoded = 128 + Math.sign(average) * magnitude;
      this.sum = this.count = 0;
      this.audible ||= encoded !== 128;
      this.packet[this.offset++] = encoded;
      if (this.offset !== this.size) continue;
      if (this.audible) {
        this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
        this.packet = new Uint8Array(this.size);
      }
      this.audible = false;
      this.offset = 0;
    }
    return true;
  }
}

registerProcessor("cuebox-voice-capture", VoiceCapture);
