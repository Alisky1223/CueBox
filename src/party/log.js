const MAX_ENTRIES = 500;

/** Connection diagnostics kept across reloads, so a failed attempt can be looked at afterwards. */
export class NetLog {
  /**
   * @param {object} [store]
   * @param {() => object[]} [store.load]
   * @param {(entries: object[]) => void} [store.save]
   * @param {() => number} [now]
   */
  constructor({ load = () => [], save = () => {} } = {}, now = Date.now) {
    const saved = load();
    this.entries = Array.isArray(saved) ? saved : [];
    this.persist = save;
    this.now = now;
  }

  add(event, data) {
    const entry = { t: this.now(), e: event };
    if (data && Object.keys(data).length) entry.d = data;
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.persist(this.entries);
  }

  clear() {
    this.entries = [];
    this.persist(this.entries);
  }

  text() {
    return this.entries
      .map(({ t, e, d }) => {
        const fields = d
          ? Object.entries(d)
              .filter(([, v]) => v !== undefined && v !== null && v !== "")
              .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
          : [];
        return [new Date(t).toISOString(), e, ...fields].join(" ");
      })
      .join("\n");
  }
}

export const noLog = { add() {} };

/** Type, protocol and relay server of a candidate, never its address. */
export function describeCandidate(c) {
  const line = c.candidate ?? "";
  return {
    type: c.type ?? /\btyp (\w+)/.exec(line)?.[1],
    protocol: c.protocol ?? /^candidate:\S+ \d+ (\w+)/i.exec(line)?.[1]?.toLowerCase(),
    relay: c.relayProtocol,
    url: c.url,
  };
}

/** Summarises which candidate pair carries the connection, or how far the pairs got when none does. */
export function summariseStats(stats) {
  const byId = new Map();
  stats.forEach((s) => byId.set(s.id, s));
  const pairs = [...byId.values()].filter((s) => s.type === "candidate-pair");
  const transport = [...byId.values()].find((s) => s.type === "transport" && s.selectedCandidatePairId);
  const selected =
    byId.get(transport?.selectedCandidatePairId) ?? pairs.find((p) => p.nominated && p.state === "succeeded");
  const side = (id) => {
    const c = byId.get(id);
    return c ? `${c.candidateType}/${c.protocol}${c.relayProtocol ? `(${c.relayProtocol})` : ""}` : "?";
  };
  const count = (list, key) => list.reduce((acc, s) => ({ ...acc, [s[key]]: (acc[s[key]] ?? 0) + 1 }), {});
  return {
    selected: selected ? `${side(selected.localCandidateId)} -> ${side(selected.remoteCandidateId)}` : "none",
    rtt: selected?.currentRoundTripTime,
    pairs: count(pairs, "state"),
    local: count(
      [...byId.values()].filter((s) => s.type === "local-candidate"),
      "candidateType",
    ),
    remote: count(
      [...byId.values()].filter((s) => s.type === "remote-candidate"),
      "candidateType",
    ),
  };
}

const watched = new WeakSet();

/** Logs ICE progress of one connection; `label` tells data and voice connections apart. */
export function watchPeerConnection(pc, log, label) {
  if (!pc || watched.has(pc)) return;
  watched.add(pc);
  const add = (event, data) => log.add(event, { pc: label, ...data });
  const stats = (why) =>
    pc
      .getStats()
      .then((s) => add("ice.stats", { why, ...summariseStats(s) }))
      .catch(() => {});

  pc.addEventListener("icegatheringstatechange", () => add("ice.gathering", { state: pc.iceGatheringState }));
  pc.addEventListener("icecandidate", (e) =>
    e.candidate?.candidate ? add("ice.candidate", describeCandidate(e.candidate)) : add("ice.candidates-done"),
  );
  pc.addEventListener("icecandidateerror", (e) =>
    add("ice.candidate-error", { url: e.url, code: e.errorCode, text: e.errorText }),
  );
  pc.addEventListener("iceconnectionstatechange", () => {
    const state = pc.iceConnectionState;
    add("ice.state", { state });
    if (state === "connected" || state === "failed" || state === "disconnected") stats(state);
  });
  pc.addEventListener("connectionstatechange", () => add("pc.state", { state: pc.connectionState }));
}
