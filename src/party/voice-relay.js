import captureSource from "./voice-capture.js?raw";
import { VOICE_PACKET_BYTES, VOICE_SAMPLE_RATE, isVoicePacket } from "./voice-packet.js";

const BUFFER_S = 0.06;
const MAX_QUEUE_S = 0.18;
const captureModules = new WeakMap();
const DECODE = Float32Array.from({ length: 256 }, (_, value) => {
  const centered = Math.max(-127, value - 128);
  return (Math.sign(centered) * Math.expm1((Math.abs(centered) * Math.log(256)) / 127)) / 255;
});

// Inline the worklet so the single-file player can also load it from file://.
const captureUrl = `data:text/javascript,${encodeURIComponent(captureSource)}`;

export class VoiceRelay {
  constructor(ctx, input, analyser, volume) {
    this.ctx = ctx;
    this.input = input;
    this.output = ctx.createGain();
    this.output.gain.value = volume;
    this.output.connect(ctx.destination);
    this.analyser = analyser;
    this.sources = new Set();
    this.nextTime = 0;
  }

  capture(send, fail) {
    this.loading ??= this.loadCapture(send, fail);
    return this.loading;
  }

  async loadCapture(send, fail) {
    if (!captureModules.has(this.ctx)) {
      captureModules.set(
        this.ctx,
        this.ctx.audioWorklet.addModule(captureUrl).catch((err) => {
          captureModules.delete(this.ctx);
          throw err;
        }),
      );
    }
    await captureModules.get(this.ctx);
    if (this.closed) return;
    const node = new AudioWorkletNode(this.ctx, "cuebox-voice-capture", {
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: { rate: VOICE_SAMPLE_RATE, size: VOICE_PACKET_BYTES },
    });
    node.port.onmessage = ({ data }) => send(data);
    node.onprocessorerror = fail;
    this.captureNode = node;
    this.input.connect(node);
    node.connect(this.ctx.destination); // The processor's output is silent.
  }

  receive(packet) {
    if (!isVoicePacket(packet) || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    if (this.nextTime > now + MAX_QUEUE_S) return;
    const buffer = this.ctx.createBuffer(1, VOICE_PACKET_BYTES, VOICE_SAMPLE_RATE);
    const samples = buffer.getChannelData(0);
    const bytes = new Uint8Array(packet);
    for (let i = 0; i < bytes.length; i++) samples[i] = DECODE[bytes[i]];

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    source.connect(this.analyser);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    if (this.nextTime < now) this.nextTime = now + BUFFER_S;
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
  }

  close() {
    this.closed = true;
    if (this.captureNode) {
      this.input.disconnect(this.captureNode);
      this.captureNode.disconnect();
      this.captureNode.port.close();
    }
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.output.disconnect();
  }
}
