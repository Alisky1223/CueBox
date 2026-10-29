import { readChat } from "../party/chat.js";
import { parseCode } from "../party/code.js";
import { PartyLink, describeError } from "../party/link.js";
import { SyncSession } from "../party/sync.js";
import { escapeHtml, formatTime } from "./format.js";
import { icon } from "./icons.js";
import { toggleMenu } from "./menu.js";
import { initPartyChat } from "./party-chat.js";
import { toast } from "./toast.js";

const formatCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

export function initPartyMenu({ button, menu, video, stage, chatButton, chatPanel }) {
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

  // status: idle | busy | waiting (host, no partner yet) | connected
  const state = { status: "idle", role: null, error: "", lastCode: "" };
  let session = null;

  const link = new PartyLink({
    onOpen() {
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
      set({ status: "connected", error: "" });
      toast("Partner connected. Playback is synced.", { type: "success" });
    },
    onMessage(msg) {
      const incoming = readChat(msg);
      if (incoming) chat.receive(incoming);
      else session?.receive(msg);
    },
    onClose() {
      endSession();
      toast("Your partner left.");
      // The host keeps its code (and the chat so far) so the partner can rejoin.
      if (state.role === "host") return set({ status: "waiting" });
      chat.reset();
      link.leave();
      set({ status: "idle", role: null, error: "Your partner left." });
    },
    onError: (err) => toast(describeError(err), { type: "error", duration: 6000 }),
  });

  const chat = initPartyChat({ stage, button: chatButton, panel: chatPanel, send: (msg) => link.send(msg) });

  const endSession = () => {
    session?.stop();
    session = null;
    chat.setConnected(false);
  };

  for (const ev of ["play", "pause", "seeked", "ratechange"]) video.addEventListener(ev, () => session?.localChange());
  video.addEventListener("loadedmetadata", () => session?.mediaLoaded());
  addEventListener("pagehide", () => link.leave());

  const set = (patch) => {
    Object.assign(state, patch);
    render();
  };

  async function host() {
    set({ status: "busy", role: "host", error: "" });
    try {
      await link.host();
      set({ status: "waiting" });
    } catch (err) {
      link.leave();
      set({ status: "idle", role: null, error: describeError(err) });
    }
  }

  async function join(input) {
    const code = parseCode(input);
    if (!code) return set({ error: "Codes are 6 letters and numbers, like abc 234." });
    set({ status: "busy", role: "guest", error: "", lastCode: code });
    try {
      await link.join(code);
    } catch (err) {
      set({ status: "idle", role: null, error: describeError(err) });
    }
  }

  function leave() {
    endSession();
    chat.reset();
    link.leave();
    set({ status: "idle", role: null, error: "" });
  }

  function render() {
    const { status, error } = state;
    const code = link.code ? `<div class="party-code" title="Code">${formatCode(link.code)}</div>` : "";
    const note = (text) => `<p class="menu-note">${text}</p>`;
    const action = (name, iconName, label) =>
      `<button class="menu-item menu-action" data-action="${name}"><span class="menu-check">${icon(iconName)}</span><span class="menu-label">${label}</span></button>`;

    let body;
    if (status === "busy") body = note("Connecting…");
    else if (status === "waiting")
      body = `${code}${action("copy", "copy", "Copy code")}${note("Send this code to your partner. Waiting for them to join…")}<div class="menu-sep"></div>${action("leave", "x", "Stop")}`;
    else if (status === "connected")
      body = `${note(`<span class="party-dot"></span>Connected. Play, pause and seeking are shared. Chat with the chat button.`)}${state.role === "host" ? code : ""}<div class="menu-sep"></div>${action("leave", "x", "Leave")}`;
    else
      body = `${note("Watch in sync with someone on another device. You each open your own copy of the same video; only play, pause, seeking and chat are shared.")}
        ${action("host", "users", "Create a code")}
        <div class="menu-sep"></div>
        <form class="party-join">
          <input name="code" placeholder="Partner's code" value="${escapeHtml(state.lastCode)}" maxlength="12" autocomplete="off" spellcheck="false" aria-label="Partner's code" />
          <button class="btn btn-primary" type="submit">Join</button>
        </form>
        ${error ? `<p class="menu-note menu-error">${escapeHtml(error)}</p>` : ""}`;

    menu.innerHTML = `<div class="menu-title">Watch together</div>${body}`;
    button.classList.toggle("on", status === "connected");
    button.title = status === "connected" ? "Watch together · connected" : "Watch together";
  }

  menu.addEventListener("submit", (e) => {
    e.preventDefault();
    join(e.target.elements.code.value);
  });
  menu.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    if (t.dataset.action === "host") host();
    else if (t.dataset.action === "leave") leave();
    else if (t.dataset.action === "copy")
      navigator.clipboard
        ?.writeText(link.code)
        .then(() => toast("Code copied", { type: "success" }))
        .catch(() => toast("Couldn't copy. Select the code and copy it by hand.", { type: "error" }));
  });

  button.onclick = () => {
    toggleMenu(button, menu);
    if (!menu.hidden) menu.querySelector("input")?.focus();
  };
  render();
}
