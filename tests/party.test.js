import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const host = new SyncSession({ media: hostMedia, leader: true, now, send: (m) => queue.push([guest, m]) });
  const guest = new SyncSession({
    media: guestMedia,
    leader: false,
    now,
    onMismatch,
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
  return { host, guest, hostMedia, guestMedia, flush, advance, queue, onMismatch };
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

  it("accepts lengths within a couple of seconds", () => {
    const p = pair({ guestDuration: 101.2 });
    p.host.start();
    p.guest.start();
    p.flush();
    expect(p.onMismatch).not.toHaveBeenCalled();
  });
});
