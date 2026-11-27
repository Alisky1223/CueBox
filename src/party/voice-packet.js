export const VOICE_SAMPLE_RATE = 8000;
export const VOICE_PACKET_BYTES = 320; // 40 ms of mono, 8-bit companded audio.

export function isVoicePacket(data) {
  return data instanceof ArrayBuffer && data.byteLength === VOICE_PACKET_BYTES;
}
