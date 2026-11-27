import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NAME, MAX_TEXT, REACTIONS, chatMessage, reactionMessage, readChat } from "../src/party/chat.js";
import { makeCode, parseCode } from "../src/party/code.js";
import { HEARTBEAT_MS, SyncSession } from "../src/party/sync.js";

describe("party codes", () => {
  it("makes 6-char codes that parse back", () => {
    for (let i = 0; i < 50; i++) {
      const code = makeCode();
      expect(code).toHaveLength(6);
      expect(parseCode(code)).toBe(code);
    }
  });

  it.each([
    [" AB3-DEF ", "ab3def"],
    ["ab3 def", "ab3def"],
    ["ab3de", null],
    ["ab3de0", null],
    ["", null],
  ])("parseCode(%j) -> %j", (input, expected) => expect(parseCode(input)).toBe(expected));
});

/** A video stand-in: changes fire the session's local-event hook like real media events would. */
function fakeMedia(duration = 100) {
  const m = {
    ready: true,
    seeking: false,
    time: 0,
    duration,
    playing: false,
    rate: 1,
    onEvent: () => {},
    play: () => ((m.playing = true), m.onEvent()),
    pause: () => ((m.playing = false), m.onEvent()),
    seek: (t) => ((m.time = t), m.onEvent()),
    setRate: (r) => ((m.rate = r), m.onEvent()),
  };
  return m;
}

function pair({ hostDuration = 100, guestDuration = 100 } = {}) {
  let clock = 0;
  const now = () => clock;
  const queue = [];
  const flush = () => {
    while (queue.length) {
      const [to, msg] = queue.shift();
      to.receive(structuredClone(msg));
    }
  };
  const hostMedia = fakeMedia(hostDuration);
  const guestMedia = fakeMedia(guestDuration);
  const onMismatch = vi.fn();
  const hostLink = vi.fn();
  const guestLink = vi.fn();
  const host = new SyncSession({
    media: hostMedia,
    leader: true,
    now,
    onVideoLink: hostLink,
    send: (m) => queue.push([guest, m]),
  });
  const guest = new SyncSession({
    media: guestMedia,
    leader: false,
    now,
    onMismatch,
    onVideoLink: guestLink,
    send: (m) => queue.push([host, m]),
  });
  hostMedia.onEvent = () => host.localChange();
  guestMedia.onEvent = () => guest.localChange();
  const advance = (ms) => {
    clock += ms;
    for (const m of [hostMedia, guestMedia]) if (m.playing) m.time += (ms / 1000) * m.rate;
    vi.advanceTimersByTime(ms);
    flush();
  };
  return { host, guest, hostMedia, guestMedia, flush, advance, queue, onMismatch, hostLink, guestLink };
}

describe("SyncSession", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("guest adopts the host's state on connect", () => {
    const p = pair();
    p.hostMedia.time = 42;
    p.hostMedia.playing = true;
    p.host.start();
    p.guest.start();
    p.flush();
    expect(p.guestMedia.playing).toBe(true);
    expect(p.guestMedia.time).toBeCloseTo(42, 1);
  });

  it("relays play, pause, seek and speed from either side", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.flush();

    p.guestMedia.play();
    p.flush();
    expect(p.hostMedia.playing).toBe(true);

    p.advance(5000);
    p.hostMedia.seek(80);
    p.flush();
    expect(p.guestMedia.time).toBeCloseTo(80, 1);

    p.advance(3000);
    p.guestMedia.setRate(1.5);
    p.flush();
    expect(p.hostMedia.rate).toBe(1.5);

    p.advance(3000);
    p.hostMedia.pause();
    p.flush();
    expect(p.guestMedia.playing).toBe(false);
  });

  it("doesn't echo applied remote changes back", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.flush();
    p.hostMedia.play();
    p.queue.length = 0;
    p.host.localChange();
    const [, msg] = p.queue.shift();
    p.guest.receive(msg);
    expect(p.guestMedia.playing).toBe(true);
    expect(p.queue.filter(([to, m]) => to === p.host && m.t === "state")).toHaveLength(0);
  });

  it("follower jumps back in sync on heartbeat when it drifts", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.hostMedia.play();
    p.flush();
    p.advance(HEARTBEAT_MS * 2);
    p.guestMedia.time += 3; // e.g. host stalled while buffering
    p.advance(HEARTBEAT_MS);
    expect(Math.abs(p.guestMedia.time - p.hostMedia.time)).toBeLessThan(0.5);
  });

  it("ignores small drift", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.hostMedia.play();
    p.flush();
    p.advance(HEARTBEAT_MS * 2);
    const seek = vi.spyOn(p.guestMedia, "seek");
    p.guestMedia.time += 0.2;
    p.advance(HEARTBEAT_MS);
    expect(seek).not.toHaveBeenCalled();
  });

  it("lines up exactly on a partner's pause", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.hostMedia.play();
    p.flush();
    p.advance(HEARTBEAT_MS * 2);
    p.guestMedia.time += 0.3;
    p.hostMedia.pause();
    p.flush();
    expect(p.guestMedia.playing).toBe(false);
    expect(p.guestMedia.time).toBeCloseTo(p.hostMedia.time, 2);
  });

  it("does nothing until the video is loaded", () => {
    const p = pair();
    p.guestMedia.ready = false;
    p.hostMedia.time = 30;
    p.hostMedia.playing = true;
    p.host.start();
    p.guest.start();
    p.flush();
    expect(p.guestMedia.playing).toBe(false);

    p.guestMedia.ready = true;
    p.guest.mediaLoaded();
    p.flush();
    expect(p.guestMedia.playing).toBe(true);
    expect(p.guestMedia.time).toBeCloseTo(30, 1);
  });

  it.each(["host", "guest"])("pairs before either video loads, then syncs when the %s opens first", (first) => {
    const p = pair();
    const second = first === "host" ? "guest" : "host";
    p.hostMedia.ready = p.guestMedia.ready = false;
    p.host.start();
    p.guest.start();
    p.flush();

    p[`${first}Media`].ready = true;
    p[first].mediaLoaded();
    p[`${first}Media`].seek(30);
    p[`${first}Media`].play();
    p.host.heartbeat();
    expect(p.queue.map(([, msg]) => msg.t)).toEqual(["hello"]);
    p.flush();
    expect(p.host.ready).toBe(false);
    expect(p.guest.ready).toBe(false);

    p[`${second}Media`].ready = true;
    p[second].mediaLoaded();
    p.flush();
    expect(p.host.ready).toBe(true);
    expect(p.guest.ready).toBe(true);
    expect(p.guestMedia.time).toBe(p.hostMedia.time);
    expect(p.guestMedia.playing).toBe(p.hostMedia.playing);

    p.guestMedia.seek(50);
    p.flush();
    expect(p.hostMedia.time).toBe(50);
  });

  it("warns once when video lengths differ", () => {
    const p = pair({ guestDuration: 90 });
    p.host.start();
    p.guest.start();
    p.flush();
    p.guest.mediaLoaded();
    p.flush();
    expect(p.onMismatch).toHaveBeenCalledTimes(1);
    expect(p.onMismatch).toHaveBeenCalledWith(90, 100);
  });

  it("opens a guest's video link on the host and ignores old playback messages while it loads", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.flush();

    const url = "https://example.com/movie.mp4";
    p.guest.shareVideoLink(url);
    p.flush();
    expect(p.hostLink).toHaveBeenCalledExactlyOnceWith(url);
    expect(p.guestLink).not.toHaveBeenCalled();
    p.host.receive({ t: "hello", duration: 10, canShareVideo: true, linkVersion: 0 });
    p.host.receive({ t: "state", time: 80, rate: 1, playing: true, linkVersion: 0 });
    expect(p.hostMedia.time).toBe(0);
    expect(p.host.ready).toBe(false);
    p.hostMedia.time = 20;
    p.host.mediaLoaded();
    p.guest.mediaLoaded();
    p.flush();
    expect(p.guestMedia.time).toBe(20);
  });

  it("uses the host's link when both viewers submit at the same time", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.flush();
    p.host.shareVideoLink("https://example.com/host.mp4");
    p.guest.shareVideoLink("https://example.com/guest.mp4");
    p.flush();
    expect(p.guestLink).toHaveBeenCalledExactlyOnceWith("https://example.com/host.mp4");
    expect(p.hostLink).not.toHaveBeenCalled();
  });

  it("shares a link even before the partner's first hello arrives", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.host.shareVideoLink("https://example.com/movie.mp4");
    p.flush();
    expect(p.guestLink).toHaveBeenCalledExactlyOnceWith("https://example.com/movie.mp4");
  });

  it("keeps playback sync with an older partner when their first hello arrives late", () => {
    const media = fakeMedia();
    const host = new SyncSession({ media, leader: true, send: vi.fn() });
    host.shareVideoLink("https://example.com/movie.mp4");
    expect(host.ready).toBe(false);
    host.receive({ t: "hello", duration: 100 });
    host.receive({ t: "state", time: 25, rate: 1, playing: false });
    expect(host.ready).toBe(true);
    expect(media.time).toBe(25);
  });

  it("ignores unsupported links without interrupting existing playback sync", () => {
    const p = pair();
    p.host.start();
    p.guest.start();
    p.flush();
    p.guest.shareVideoLink("https://user:password@example.com/movie.mp4");
    p.host.receive({ t: "video-link", url: "file:///movie.mp4", linkVersion: 2 });
    p.flush();
    expect(p.hostLink).not.toHaveBeenCalled();
    expect(p.host.ready).toBe(true);
    expect(p.guest.ready).toBe(true);
  });

  it("accepts lengths within a couple of seconds", () => {
    const p = pair({ guestDuration: 101.2 });
    p.host.start();
    p.guest.start();
    p.flush();
    expect(p.onMismatch).not.toHaveBeenCalled();
  });
});

describe("chat messages", () => {
  it("trims text and names, and drops empty text", () => {
    expect(chatMessage("  hi  ", "  Sam  Lee ")).toEqual({ t: "chat", text: "hi", name: "Sam Lee" });
    expect(chatMessage("   ", "Sam")).toBeNull();
    expect(chatMessage(42, "Sam")).toBeNull();
  });

  it("caps text and name lengths", () => {
    const msg = chatMessage("x".repeat(MAX_TEXT + 50), "n".repeat(MAX_NAME + 5));
    expect(msg.text).toHaveLength(MAX_TEXT);
    expect(msg.name).toHaveLength(MAX_NAME);
  });

  it("only allows the listed reactions", () => {
    expect(reactionMessage(REACTIONS[0], "")).toEqual({ t: "react", emoji: REACTIONS[0], name: "" });
    expect(reactionMessage("<b>", "")).toBeNull();
  });

  it("reads a partner's chat and reactions, rejecting junk", () => {
    expect(readChat({ t: "chat", text: " yo ", name: 5 })).toEqual({ kind: "text", text: "yo", name: "" });
    expect(readChat({ t: "react", emoji: REACTIONS[1], name: "Al" })).toEqual({
      kind: "react",
      emoji: REACTIONS[1],
      name: "Al",
    });
    expect(readChat({ t: "react", emoji: "💩" })).toBeNull();
    expect(readChat({ t: "chat", text: "" })).toBeNull();
    expect(readChat({ t: "state", playing: true })).toBeNull();
    expect(readChat(null)).toBeNull();
  });
});
