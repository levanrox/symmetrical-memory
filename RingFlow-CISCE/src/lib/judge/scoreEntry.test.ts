import { describe, expect, it } from "vitest";
import {
  clampTenths,
  formatTenths,
  generateIdempotencyKey,
  QUICK_SET_TENTHS,
  SCORE_MAX_TENTHS,
  SCORE_MIN_TENTHS,
  SCORE_START_TENTHS,
  stepTenths,
  tenthsToPoints,
} from "./scoreEntry";

describe("clampTenths", () => {
  it("clamps below/above the legal range", () => {
    expect(clampTenths(0)).toBe(SCORE_MIN_TENTHS);
    expect(clampTenths(49.4)).toBe(SCORE_MIN_TENTHS);
    expect(clampTenths(100.6)).toBe(SCORE_MAX_TENTHS);
    expect(clampTenths(500)).toBe(SCORE_MAX_TENTHS);
  });
  it("snaps fractional tenths to whole tenths", () => {
    expect(clampTenths(73.4)).toBe(73);
    expect(clampTenths(73.5)).toBe(74);
    expect(clampTenths(72.50001)).toBe(73);
  });
  it("keeps in-range values untouched", () => {
    expect(clampTenths(50)).toBe(50);
    expect(clampTenths(85)).toBe(85);
    expect(clampTenths(100)).toBe(100);
  });
  it("treats non-finite input as the minimum", () => {
    expect(clampTenths(NaN)).toBe(SCORE_MIN_TENTHS);
    expect(clampTenths(Infinity)).toBe(SCORE_MIN_TENTHS);
  });
});

describe("stepTenths", () => {
  it("starts at the typical mark from no mark, in both directions", () => {
    expect(stepTenths(null, 1)).toBe(SCORE_START_TENTHS);
    expect(stepTenths(null, -1)).toBe(SCORE_START_TENTHS);
  });
  it("steps by exactly one tenth", () => {
    expect(stepTenths(70, 1)).toBe(71);
    expect(stepTenths(70, -1)).toBe(69);
  });
  it("never leaves the legal range", () => {
    expect(stepTenths(100, 1)).toBe(100);
    expect(stepTenths(50, -1)).toBe(50);
  });
  it("stays exact over many steps (no float drift)", () => {
    let t: number | null = null;
    for (let i = 0; i < 33; i++) t = stepTenths(t, 1);
    expect(t).toBe(100); // 70 + 33 would be 103 -> clamped
    t = 50;
    for (let i = 0; i < 25; i++) t = stepTenths(t, 1);
    expect(t).toBe(75);
  });
});

describe("formatTenths", () => {
  it("formats one decimal place", () => {
    expect(formatTenths(73)).toBe("7.3");
    expect(formatTenths(50)).toBe("5.0");
    expect(formatTenths(100)).toBe("10.0");
  });
  it("renders no mark as an em dash", () => {
    expect(formatTenths(null)).toBe("–");
  });
});

describe("tenthsToPoints", () => {
  it("converts to API points", () => {
    expect(tenthsToPoints(73)).toBe(7.3);
    expect(tenthsToPoints(100)).toBe(10);
  });
});

describe("QUICK_SET_TENTHS", () => {
  it("covers the whole legal range in whole numbers", () => {
    expect([...QUICK_SET_TENTHS]).toEqual([50, 60, 70, 80, 90, 100]);
  });
});

describe("generateIdempotencyKey", () => {
  it("generates unique uuid-shaped keys", () => {
    const keys = new Set(
      Array.from({ length: 100 }, () => generateIdempotencyKey())
    );
    expect(keys.size).toBe(100);
    for (const k of keys) {
      expect(k.length).toBeLessThanOrEqual(128);
      expect(k.length).toBeGreaterThan(0);
    }
  });
  it("prefers crypto.randomUUID when available", () => {
    const k = generateIdempotencyKey();
    expect(k).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
