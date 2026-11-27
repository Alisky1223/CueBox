import { rejectRoom } from "./party-room.js";
export { PartyRoom } from "./party-room.js";

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }
    const room = url.searchParams.get("room")?.trim().toUpperCase() ?? "";
    const role = url.searchParams.get("role");
    if (!/^[A-HJ-KM-NP-Z2-9]{6}$/.test(room) || !["host", "guest"].includes(role)) {
      return rejectRoom("bad-room", "Enter a valid CueBox room code.");
    }
    return env.PARTY_ROOMS.getByName(room).fetch(request);
  },
};
