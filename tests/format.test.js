import { describe, expect, it } from "vitest";
import { formatDelay, formatTime } from "../src/ui/format.js";

describe("formatTime", () => {
  it.each([
    [0, "0:00"],
    [5.9, "0:05"],
    [65, "1:05"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
    [NaN, "0:00"],
    [-3, "0:00"],
    [Infinity, "0:00"],
  ])("%s -> %s", (input, expected) => expect(formatTime(input)).toBe(expected));
});

describe("formatDelay", () => {
  it.each([
    [0, "0.0s"],
    [0.5, "+0.5s"],
    [-1.2, "−1.2s"],
  ])("%s -> %s", (input, expected) => expect(formatDelay(input)).toBe(expected));
});
