import { DurableObject } from "cloudflare:workers";
import { isVoicePacket } from "../src/party/voice-packet.js";

const MAX_BYTES = 16 * 1024;
const LEFT = 4000;
const encoder = new TextEncoder();
const upgrade = (client) => new Response(null, { status: 101, webSocket: client });

export function rejectRoom(reason, message) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ type: "rejected", reason, message }));
  server.close(1008, "rejected");
  return upgrade(client);
}

export class PartyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.voiceQueue = new WeakMap();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  fetch(request) {
    const params = new URL(request.url).searchParams;
    const role = params.get("role");
    const token = params.get("token") ?? "";
    if (!/^[a-f0-9]{32}$/.test(token)) return rejectRoom("bad-room", "Invalid session.");

    const player = role === "host" ? 1 : 2;
    const peer = this.socketFor(3 - player);
    const current = this.ctx.getWebSockets(String(player)).find((socket) => socket.deserializeAttachment());
    if (current?.readyState === WebSocket.OPEN && current.deserializeAttachment().token !== token) {
      return rejectRoom("room-full", "This code is already in use.");
    }
    if (player === 2 && !peer) return rejectRoom("peer-unavailable", "No one is waiting with that code.");
    if (current) this.release(current, false, 4001, "Reconnected");

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [String(player)]);
    const voiceRelay = params.get("voice") === "relay";
    server.serializeAttachment({ player, token, voiceRelay });
    server.send(
      JSON.stringify({
        type: "joined",
        player,
        peer: Boolean(peer),
        voiceRelay: true,
        peerVoiceRelay: peer?.deserializeAttachment().voiceRelay === true,
      }),
    );
    peer?.send(JSON.stringify({ type: "peer-joined", peerVoiceRelay: voiceRelay }));
    return upgrade(client);
  }

  webSocketMessage(socket, text) {
    const session = socket.deserializeAttachment();
    if (!session) return;
    if (typeof text !== "string") {
      if (session.voiceRelay && isVoicePacket(text)) this.relayVoice(socket, session, text);
      return;
    }
    if (text.length > MAX_BYTES || encoder.encode(text).byteLength > MAX_BYTES) {
      return this.release(socket, false, 1009, "Message too large");
    }
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message?.type === "app-data" && message.payload && typeof message.payload === "object") {
      this.socketFor(3 - session.player)?.send(text);
    }
  }

  relayVoice(socket, session, packet) {
    const peer = this.socketFor(3 - session.player);
    if (!peer?.deserializeAttachment().voiceRelay) return;
    // Allow small bursts, while capping sustained traffic above the sender's 25 packets per second.
    const now = Date.now();
    const next = Math.max(now - 240, this.voiceQueue.get(socket) ?? now);
    if (next > now + 30) return;
    this.voiceQueue.set(socket, next + 30);
    peer.send(packet);
  }

  webSocketClose(socket, code, reason) {
    this.release(socket, code === LEFT);
    if (socket.readyState === WebSocket.CLOSING) {
      if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) socket.close(code, reason);
      else socket.close();
    }
  }

  webSocketError(socket) {
    this.release(socket, false, 1011, "WebSocket error");
  }

  release(socket, left, code, reason) {
    const session = socket.deserializeAttachment();
    if (!session) return;
    socket.serializeAttachment(null);
    if (code && socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    if (!this.socketFor(session.player)) {
      this.socketFor(3 - session.player)?.send(JSON.stringify({ type: "peer-left", left }));
    }
  }

  socketFor(player) {
    return this.ctx
      .getWebSockets(String(player))
      .find((socket) => socket.readyState === WebSocket.OPEN && socket.deserializeAttachment());
  }
}
