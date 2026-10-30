import { describe, expect, it } from "vitest";
import { classifyDrag, seekTarget, stepLevel } from "../src/ui/gestures.js";

describe("classifyDrag", () => {
  it("ignores movement under the threshold", () => {
    expect(classifyDrag(5, 5, 0.2)).toBeNull();
  });

  it("treats mostly horizontal movement as a seek on either side", () => {
    expect(classifyDrag(30, 10, 0.2)).toBe("seek");
    expect(classifyDrag(-30, 10, 0.8)).toBe("seek");
  });

  it("splits vertical movement by the side the drag started on", () => {
    expect(classifyDrag(2, -30, 0.2)).toBe("brightness");
    expect(classifyDrag(2, 30, 0.8)).toBe("volume");
  });
});

describe("stepLevel", () => {
  it("maps a full-length drag to the full range", () => {
    expect(stepLevel(0, 1, 0, 1)).toBe(1);
    expect(stepLevel(0.3, 1, 0.3, 1.5)).toBe(1.5);
  });

  it("clamps to the range", () => {
    expect(stepLevel(0.9, 0.5, 0, 1)).toBe(1);
    expect(stepLevel(0.4, -0.5, 0.3, 1.5)).toBe(0.3);
  });

  it("snaps to 5% steps so normal brightness is reachable", () => {
    expect(stepLevel(0.9, 0.09, 0.3, 1.5)).toBe(1);
  });
});

describe("seekTarget", () => {
  it("moves 90 seconds per full width, in whole seconds", () => {
    expect(seekTarget(100, 1000, 1)).toBe(190);
    expect(seekTarget(100, 1000, -0.5)).toBe(55);
    expect(seekTarget(100, 1000, 0.123)).toBe(111);
  });

  it("stays inside the video", () => {
    expect(seekTarget(10, 1000, -1)).toBe(0);
    expect(seekTarget(990, 1000, 1)).toBe(1000);
  });
});
