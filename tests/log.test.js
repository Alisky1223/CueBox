import { describe, expect, it } from "vitest";
import { NetLog, describeCandidate, summariseStats } from "../src/party/log.js";

describe("connection log", () => {
  it("keeps entries across instances through the store", () => {
    let stored = [];
    const store = { load: () => stored, save: (e) => (stored = [...e]) };
    new NetLog(store, () => 0).add("server.open");
    const log = new NetLog(store, () => 1000);
    log.add("ice.state", { state: "failed", empty: "", none: undefined });
    expect(log.text()).toBe("1970-01-01T00:00:00.000Z server.open\n1970-01-01T00:00:01.000Z ice.state state=failed");
  });

  it("drops the oldest entries past the cap", () => {
    const log = new NetLog();
    for (let i = 0; i < 600; i++) log.add(`e${i}`);
    expect(log.entries).toHaveLength(500);
    expect(log.entries[0].e).toBe("e100");
  });

  it("ignores a corrupt store and clears", () => {
    const log = new NetLog({ load: () => "junk" });
    expect(log.entries).toEqual([]);
    log.add("x");
    log.clear();
    expect(log.text()).toBe("");
  });
});

describe("candidates", () => {
  it("reads type and protocol without the address", () => {
    const c = { candidate: "candidate:1 1 UDP 2122 192.168.1.5 50000 typ srflx raddr 0.0.0.0 rport 0" };
    const d = describeCandidate(c);
    expect(d).toEqual({ type: "srflx", protocol: "udp", relay: undefined, url: undefined });
    expect(JSON.stringify(d)).not.toContain("192.168");
  });

  it("summarises the selected pair", () => {
    const stats = new Map(
      [
        { id: "t", type: "transport", selectedCandidatePairId: "p1" },
        {
          id: "p1",
          type: "candidate-pair",
          state: "succeeded",
          localCandidateId: "l1",
          remoteCandidateId: "r1",
          currentRoundTripTime: 0.1,
        },
        { id: "p2", type: "candidate-pair", state: "failed", localCandidateId: "l2", remoteCandidateId: "r1" },
        { id: "l1", type: "local-candidate", candidateType: "relay", protocol: "udp", relayProtocol: "tcp" },
        { id: "l2", type: "local-candidate", candidateType: "host", protocol: "udp" },
        { id: "r1", type: "remote-candidate", candidateType: "srflx", protocol: "udp" },
      ].map((s) => [s.id, s]),
    );
    expect(summariseStats(stats)).toEqual({
      selected: "relay/udp(tcp) -> srflx/udp",
      rtt: 0.1,
      pairs: { succeeded: 1, failed: 1 },
      local: { relay: 1, host: 1 },
      remote: { srflx: 1 },
    });
  });

  it("reports no pair when none connected", () => {
    expect(summariseStats(new Map()).selected).toBe("none");
  });
});
