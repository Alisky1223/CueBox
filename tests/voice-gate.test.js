import { describe, expect, it } from "vitest";
import { HOLD_MS, LevelGate, approach, levelDb } from "../src/party/voice-gate.js";

describe("levelDb", () => {
  it("is 0 dB for a full-scale square wave", () => {
    expect(levelDb(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(0);
  });

  it("drops 20 dB per tenfold amplitude", () => {
    expect(levelDb(new Float32Array(8).fill(0.1))).toBeCloseTo(-20);
    expect(levelDb(new Float32Array(8).fill(0.01))).toBeCloseTo(-40);
  });

  it("floors silence and empty input", () => {
    expect(levelDb(new Float32Array(8))).toBe(-100);
    expect(levelDb(new Float32Array(0))).toBe(-100);
  });
});

describe("LevelGate", () => {
  it("stays closed under the threshold", () => {
    const gate = new LevelGate(-40);
    expect(gate.update(-60, 0)).toBe(false);
    expect(gate.update(-41, 40)).toBe(false);
  });

  it("opens at the threshold and holds through short pauses", () => {
    const gate = new LevelGate(-40);
    expect(gate.update(-30, 1000)).toBe(true);
    expect(gate.update(-70, 1000 + HOLD_MS - 1)).toBe(true);
    expect(gate.update(-70, 1000 + HOLD_MS)).toBe(false);
  });

  it("restarts the hold on each loud moment", () => {
    const gate = new LevelGate(-40, 100);
    gate.update(-30, 0);
    gate.update(-30, 80);
    expect(gate.update(-70, 150)).toBe(true);
    expect(gate.update(-70, 180)).toBe(false);
  });

  it("follows threshold changes and resets", () => {
    const gate = new LevelGate(-40);
    gate.threshold = -20;
    expect(gate.update(-30, 0)).toBe(false);
    expect(gate.update(-10, 10)).toBe(true);
    gate.reset();
    expect(gate.update(-70, 20)).toBe(false);
  });
});

describe("approach", () => {
  it("moves toward the target by the time constant", () => {
    expect(approach(1, 0, 100, 100)).toBeCloseTo(Math.exp(-1));
    expect(approach(0.3, 1, 0, 100)).toBeCloseTo(0.3);
    expect(approach(0.3, 1, 1e6, 100)).toBeCloseTo(1);
  });
});
