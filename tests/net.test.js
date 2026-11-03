import { describe, expect, it } from "vitest";
import { customIceServer, iceServers, limitVoice } from "../src/party/net.js";

describe("relay server settings", () => {
  it("is empty without urls", () => {
    expect(customIceServer(null)).toBeNull();
    expect(customIceServer({ urls: "  " })).toBeNull();
  });

  it("splits urls and keeps credentials", () => {
    expect(
      customIceServer({ urls: "turns:a.com:443, turn:a.com:3478?transport=tcp", username: "u", credential: "p" }),
    ).toEqual({
      urls: ["turns:a.com:443", "turn:a.com:3478?transport=tcp"],
      username: "u",
      credential: "p",
    });
  });

  it("rejects non-ICE urls", () => {
    expect(customIceServer({ urls: "https://a.com" })).toBeUndefined();
  });

  it("puts the user's server first", () => {
    const servers = iceServers({ urls: "turn:mine.com" });
    expect(servers[0].urls).toEqual(["turn:mine.com"]);
    expect(servers.length).toBe(iceServers(null).length + 1);
  });

  it("offers TURN over TCP for networks that block UDP", () => {
    expect(
      iceServers(null)
        .flatMap((s) => s.urls)
        .some((u) => u.includes("transport=tcp")),
    ).toBe(true);
  });
});

describe("limitVoice", () => {
  const sdp = (fmtp) =>
    ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111 0", "a=rtpmap:111 opus/48000/2", fmtp, "a=rtpmap:0 PCMU/8000", ""]
      .filter((l) => l !== null)
      .join("\r\n");

  it("merges into the existing opus fmtp", () => {
    const out = limitVoice(sdp("a=fmtp:111 minptime=10;useinbandfec=0"), 24);
    expect(out).toContain("a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=24000\r\n");
  });

  it("adds an fmtp line when missing", () => {
    const out = limitVoice(sdp(null), 24);
    expect(out).toContain("a=rtpmap:111 opus/48000/2\r\na=fmtp:111 maxaveragebitrate=24000;useinbandfec=1\r\n");
  });

  it("leaves sdp without opus alone", () => {
    const plain = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
    expect(limitVoice(plain)).toBe(plain);
  });
});
