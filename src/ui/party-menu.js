import { readChat } from "../party/chat.js";
import { parseCode } from "../party/code.js";
import { PartyLink, describeError } from "../party/link.js";
import { NetLog } from "../party/log.js";
import { FREE_RELAY, activeRelay, customIceServer, readRelays } from "../party/net.js";
import { SyncSession } from "../party/sync.js";
import { VoiceChat } from "../party/voice.js";
import { escapeHtml, formatTime } from "./format.js";
import { icon } from "./icons.js";
import { toggleMenu } from "./menu.js";
import { initPartyChat } from "./party-chat.js";
import { initPartyVoice } from "./party-voice.js";
import { load, save } from "./storage.js";
import { toast } from "./toast.js";

const ICE_KEY = "partyIce";
const RELAYS_KEY = "partyRelays";
const VOICE_RELAY_KEY = "partyVoiceRelay";
const LOG_KEY = "partyLog";
const SLOW_MS = 8000;
const REJOIN_TRIES = 4;
const REJOIN_GAP_MS = 2000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const formatCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

export function initPartyMenu({ button, menu, video, stage, chatButton, chatPanel, micButton, voiceMode, onDuck }) {
  const media = {
    get ready() {
      return video.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(video.duration);
    },
    get seeking() {
      return video.seeking;
    },
    get time() {
      return video.currentTime;
    },
    get duration() {
      return video.duration;
    },
    get playing() {
      return !video.paused;
    },
    get rate() {
      return video.playbackRate;
    },
    play: () =>
      video.play().catch(() => toast("Your partner pressed play. Press play to join in.", { duration: 6000 })),
    pause: () => video.pause(),
    seek: (time) => (video.currentTime = time),
    setRate: (rate) => (video.playbackRate = rate),
  };

  const state = { status: "idle", role: null, error: "", lastCode: "", slow: false };
  let session = null;
  let partnerTimer;
  let reconnectAttempt;
  const relays = readRelays(load(RELAYS_KEY, null), load(ICE_KEY, null));
  const ice = () => activeRelay(relays);
  const saveRelays = () => save(RELAYS_KEY, relays);
  let netOpen = load(VOICE_RELAY_KEY, false) === true || relays.active !== FREE_RELAY;
  const log = new NetLog({ load: () => load(LOG_KEY, []), save: (entries) => save(LOG_KEY, entries) });

  /** Starts a log section for one attempt, with what's known about this browser and network. */
  const logStart = (event, data) =>
    log.add(event, {
      ...data,
      online: navigator.onLine,
      net: navigator.connection?.effectiveType,
      relay: ice()?.name ?? "free",
      relayUrls: customIceServer(ice())?.urls,
      ua: navigator.userAgent,
    });

  const link = new PartyLink(
    {
      onOpen() {
        const rejoined = Boolean(session) || state.status === "reconnecting";
        endSession();
        session = new SyncSession({
          media,
          leader: state.role === "host",
          send: (msg) => link.send(msg),
          onMismatch: (local, remote) =>
            toast(
              `Your videos have different lengths (${formatTime(local)} here, ${formatTime(remote)} for your partner). Make sure you both opened the same version.`,
              { type: "error", duration: 8000 },
            ),
        });
        session.start();
        chat.setConnected(true);
        voiceUi.setConnected(true);
        voice.open(link, { leader: state.role === "host" });
        set({ status: "connected", error: "" });
        toast(rejoined ? "Reconnected." : "Partner connected. Playback is synced.", { type: "success" });
      },
      onMessage(msg) {
        if (msg.t.startsWith("rtc-")) return voice.receiveSignal(msg);
        const incoming = readChat(msg);
        if (incoming) chat.receive(incoming);
        else session?.receive(msg);
      },
      onVoice(packet) {
        voice.receiveVoice(packet);
      },
      onClose({ left }) {
        log.add("partner.lost", { left, role: state.role });
        endSession();
        // The host keeps its code (and the chat so far) so the partner can rejoin.
        if (state.role === "host") {
          toast(left ? "Your partner left." : "Lost your partner. Waiting for them to reconnect…");
          return set({ status: "waiting" });
        }
        if (!left) {
          toast("Lost your partner. Waiting for them to reconnect…");
          set({ status: "reconnecting" });
          partnerTimer = setTimeout(() => stopWithError("Lost the connection to your partner."), 30000);
          return;
        }
        toast("Your partner left.");
        stopWithError("Your partner left.");
      },
      onDisconnect() {
        endSession();
        void rejoin();
      },
    },
    log,
  );
  link.voiceRelay = load(VOICE_RELAY_KEY, false) === true;

  const voice = new VoiceChat({
    onChange: () => voiceUi.update(),
    onLevel: (db) => voiceUi.meter(db),
    onDuck,
    onError: (err) => toast(err.message, { type: "error", duration: 6000 }),
    getIce: ice,
    log,
  });
  const voiceUi = initPartyVoice({ voice, button: micButton, modeSwitch: voiceMode, stage, menu });

  const chat = initPartyChat({ stage, button: chatButton, panel: chatPanel, send: (msg) => link.send(msg) });

  const endSession = () => {
    clearTimeout(partnerTimer);
    session?.stop();
    session = null;
    chat.setConnected(false);
    voice.close();
    voiceUi.setConnected(false);
  };

  for (const ev of ["play", "pause", "seeked", "ratechange"]) video.addEventListener(ev, () => session?.localChange());
  video.addEventListener("loadedmetadata", () => session?.mediaLoaded());
  addEventListener("pagehide", () => link.leave());

  const set = (patch) => {
    Object.assign(state, patch);
    render();
  };

  const busy = (patch) => {
    set({ status: "busy", error: "", slow: false, ...patch });
    setTimeout(() => state.status === "busy" && set({ slow: true }), SLOW_MS);
  };

  async function host() {
    busy({ role: "host" });
    logStart("--- host");
    try {
      await link.host();
      if (state.status === "busy") set({ status: "waiting" });
    } catch (err) {
      link.leave();
      set({ status: "idle", role: null, error: describeError(err) });
    }
  }

  async function join(input) {
    const code = parseCode(input);
    if (!code) return set({ error: "Codes are 6 letters and numbers, like abc 234." });
    busy({ role: "guest", lastCode: code });
    logStart("--- join");
    try {
      await link.join(code);
    } catch (err) {
      link.leave();
      set({ status: "idle", role: null, error: describeError(err) });
    }
  }

  async function rejoin() {
    const attempt = (reconnectAttempt = {});
    set({ status: "reconnecting" });
    toast("Connection lost. Reconnecting…");
    for (let i = 0; i < REJOIN_TRIES; i++) {
      if (i) await wait(REJOIN_GAP_MS);
      if (reconnectAttempt !== attempt) return;
      logStart("--- rejoin", { try: i + 1 });
      try {
        await link.reconnect();
        if (reconnectAttempt === attempt && state.role === "host" && !link.connected) set({ status: "waiting" });
        return;
      } catch (err) {
        if (reconnectAttempt !== attempt) return;
        if (err.type === "room-full" || i === REJOIN_TRIES - 1) {
          return stopWithError(`Lost the connection to your partner. ${describeError(err)}`);
        }
      }
    }
  }

  function stopWithError(error = "") {
    reconnectAttempt = null;
    endSession();
    chat.reset();
    link.leave();
    set({ status: "idle", role: null, error });
  }

  function render() {
    const { status, error } = state;
    const code = link.code ? `<div class="party-code" title="Code">${formatCode(link.code)}</div>` : "";
    const note = (text) => `<p class="menu-note">${text}</p>`;
    const action = (name, iconName, label) =>
      `<button class="menu-item menu-action" data-action="${name}"><span class="menu-check">${icon(iconName)}</span><span class="menu-label">${label}</span></button>`;

    let body;
    if (status === "busy")
      body = note(state.slow ? "Still connecting… On a slow network this can take up to 30 seconds." : "Connecting…");
    else if (status === "reconnecting")
      body = `${note("Connection lost. Reconnecting…")}<div class="menu-sep"></div>${action("leave", "x", "Leave")}`;
    else if (status === "waiting")
      body = `${code}${action("copy", "copy", "Copy code")}${note("Send this code to your partner. Waiting for them to join…")}<div class="menu-sep"></div>${action("leave", "x", "Stop")}`;
    else if (status === "connected")
      body = `${note(`<span class="party-dot"></span>Connected. Play, pause and seeking are shared. Chat with the chat button, talk with the mic button.`)}${state.role === "host" ? code : ""}${voiceUi.section()}<div class="menu-sep"></div>${action("leave", "x", "Leave")}`;
    else
      body = `${note("Watch in sync with someone on another device. You each open your own copy of the same video; only play, pause, seeking, chat and voice are shared.")}
        ${action("host", "users", "Create a code")}
        <div class="menu-sep"></div>
        <form class="party-join">
          <input name="code" placeholder="Partner's code" value="${escapeHtml(state.lastCode)}" maxlength="12" autocomplete="off" spellcheck="false" aria-label="Partner's code" />
          <button class="btn btn-primary" type="submit">Join</button>
        </form>
        ${error ? `<p class="menu-note menu-error">${escapeHtml(error)}</p>` : ""}
        <details class="party-net"${netOpen ? " open" : ""}>
          <summary>Network settings</summary>
          <select name="voice-transport" aria-label="Voice connection">
            <option value="webrtc"${link.voiceRelay ? "" : " selected"}>WebRTC (default)</option>
            <option value="cloudflare"${link.voiceRelay ? " selected" : ""}>Cloudflare voice relay</option>
          </select>
          ${
            link.voiceRelay
              ? note(
                  "Both viewers must choose Cloudflare voice relay before joining. Mic audio passes through Cloudflare.",
                )
              : `${note("You can add a TURN server to help WebRTC connect on restricted networks.")}${relayFields()}`
          }
          <p class="menu-note party-log-note">Connection log: what happened on recent attempts, to find out why connecting fails. No addresses or passwords are kept.</p>
          <div class="party-log">
            <button class="btn" type="button" data-action="log-copy">Copy log</button>
            <button class="btn" type="button" data-action="log-save">Download</button>
            <button class="btn" type="button" data-action="log-clear">Clear</button>
          </div>
        </details>`;

    menu.innerHTML = `<div class="menu-title">Watch together</div>${body}`;
    button.classList.toggle("on", status === "connected");
    button.title = status === "connected" ? "Watch together · connected" : "Watch together";
  }

  function relayFields() {
    const relay = ice();
    const option = (value, label) =>
      `<option value="${escapeHtml(value)}"${value === relays.active ? " selected" : ""}>${escapeHtml(label)}</option>`;
    const select = `<select name="relay" aria-label="Relay server">
      ${option(FREE_RELAY, "Default voice connection (STUN)")}
      ${relays.list.map((r) => option(r.id, r.name || "Unnamed relay")).join("")}
      <option value="new">Add a relay…</option>
    </select>`;
    if (!relay) return select;
    return `${select}
      <input name="name" placeholder="Name" value="${escapeHtml(relay.name)}" autocomplete="off" aria-label="Relay name" />
      <input name="urls" placeholder="turns:relay.example.com:443 turn:relay.example.com:80" value="${escapeHtml(relay.urls)}" autocomplete="off" spellcheck="false" aria-label="Relay server URLs, separated by spaces" />
      <input name="username" placeholder="Username" value="${escapeHtml(relay.username)}" autocomplete="off" aria-label="Relay username" />
      <input name="credential" type="password" placeholder="Password" value="${escapeHtml(relay.credential)}" autocomplete="off" aria-label="Relay password" />
      <button class="btn party-relay-delete" type="button" data-action="relay-delete">Delete this relay</button>`;
  }

  menu.addEventListener(
    "toggle",
    (e) => {
      if (e.target.matches?.(".party-net")) netOpen = e.target.open;
    },
    true,
  );
  menu.addEventListener("input", (e) => {
    const field = e.target.closest(".party-net input");
    const relay = ice();
    if (!field || !relay) return;
    relay[field.name] = field.name === "name" ? field.value : field.value.trim();
    saveRelays();
    if (field.name === "name") {
      const option = menu.querySelector(`.party-net option[value="${CSS.escape(relay.id)}"]`);
      if (option) option.textContent = relay.name || "Unnamed relay";
    }
  });
  menu.addEventListener("change", (e) => {
    const select = e.target.closest(".party-net select");
    if (!select) return;
    if (select.name === "voice-transport") {
      link.voiceRelay = select.value === "cloudflare";
      save(VOICE_RELAY_KEY, link.voiceRelay);
      render();
      menu.querySelector('[name="voice-transport"]').focus();
      return;
    }
    if (select.value === "new") {
      const relay = {
        id: `r${Date.now().toString(36)}`,
        name: `Relay ${relays.list.length + 1}`,
        urls: "",
        username: "",
        credential: "",
      };
      relays.list.push(relay);
      relays.active = relay.id;
    } else relays.active = select.value;
    saveRelays();
    set({ error: "" });
  });
  menu.addEventListener("submit", (e) => {
    e.preventDefault();
    join(e.target.elements.code.value);
  });
  menu.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    if (t.dataset.action === "host") host();
    else if (t.dataset.action === "leave") stopWithError();
    else if (t.dataset.action === "relay-delete") {
      relays.list = relays.list.filter((r) => r.id !== relays.active);
      relays.active = FREE_RELAY;
      saveRelays();
      render();
    } else if (t.dataset.action === "log-copy")
      navigator.clipboard
        ?.writeText(log.text())
        .then(() => toast("Log copied", { type: "success" }))
        .catch(() => toast("Couldn't copy. Use Download instead.", { type: "error" }));
    else if (t.dataset.action === "log-save") downloadLog();
    else if (t.dataset.action === "log-clear") {
      log.clear();
      toast("Log cleared");
    } else if (t.dataset.action === "copy")
      navigator.clipboard
        ?.writeText(link.code)
        .then(() => toast("Code copied", { type: "success" }))
        .catch(() => toast("Couldn't copy. Select the code and copy it by hand.", { type: "error" }));
  });

  function downloadLog() {
    const url = URL.createObjectURL(new Blob([`${log.text()}\n`], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `cuebox-connection-log-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  button.onclick = () => {
    toggleMenu(button, menu);
    if (!menu.hidden) menu.querySelector("input")?.focus();
  };
  render();
}
