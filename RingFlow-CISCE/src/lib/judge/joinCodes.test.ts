/**
 * Unit tests for the judge join-code plumbing (src/lib/judge/joinCodes.ts).
 *
 * Pure functions only: generation (alphabet, length, uniqueness), expiry,
 * name sanitization, seat assignment, and panel-size resolution.
 */

import { describe, expect, it } from "vitest";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  JOIN_CODE_TTL_MS,
  defaultJoinCodeExpiry,
  generateJoinCodeValue,
  isJoinCodeExpired,
  lowestFreeSeat,
  normalizeJoinCodeInput,
  resolvePanelSize,
  sanitizeJudgeName,
} from "./joinCodes";

describe("JOIN_CODE_ALPHABET", () => {
  it("has 31 unambiguous characters (no 0/O/1/I/L)", () => {
    // 8 digits (2-9) + 23 letters (A-Z minus I, L, O).
    expect(JOIN_CODE_ALPHABET).toHaveLength(31);
    for (const ch of ["0", "O", "1", "I", "L"]) {
      expect(JOIN_CODE_ALPHABET).not.toContain(ch);
    }
    expect(new Set(JOIN_CODE_ALPHABET).size).toBe(JOIN_CODE_ALPHABET.length);
  });
});

describe("generateJoinCodeValue", () => {
  it("produces codes of the right length from the alphabet (deterministic random)", () => {
    let counter = 0;
    const rand = (n: number) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) out[i] = (counter += 7) % 256;
      return out;
    };
    for (let i = 0; i < 50; i += 1) {
      const code = generateJoinCodeValue(rand);
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      for (const ch of code) expect(JOIN_CODE_ALPHABET).toContain(ch);
    }
  });

  it("is unique across 1000 real CSPRNG generations", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i += 1) codes.add(generateJoinCodeValue());
    expect(codes.size).toBe(1000);
  });

  it("throws when the random source is short", () => {
    expect(() => generateJoinCodeValue(() => new Uint8Array(2))).toThrow();
  });

  it("rejects bytes >= 248 (rejection sampling, P9 L-2)", () => {
    // 247 is accepted (247 % 31 = 30 -> last alphabet char); 248+ are not.
    const code = generateJoinCodeValue(() => new Uint8Array(12).fill(247));
    expect(code).toBe(JOIN_CODE_ALPHABET[30]!.repeat(JOIN_CODE_LENGTH));
  });

  it("fails loudly instead of hanging on a degenerate source", () => {
    expect(() => generateJoinCodeValue(() => new Uint8Array(12).fill(255))).toThrow(
      /exhausted/
    );
  });

  it("is approximately uniform across symbols (P9 L-2)", () => {
    const counts = new Map<string, number>();
    const N = 6000;
    for (let i = 0; i < N; i += 1) {
      for (const ch of generateJoinCodeValue()) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    const expected = (N * JOIN_CODE_LENGTH) / JOIN_CODE_ALPHABET.length;
    for (const ch of JOIN_CODE_ALPHABET) {
      const c = counts.get(ch) ?? 0;
      // +/-25% of expected is ~8 sigma at these counts: a failure means real
      // bias (plain `byte % 31` would skew the first 8 symbols by +3.2%).
      expect(Math.abs(c - expected) / expected).toBeLessThan(0.25);
    }
  });
});

describe("defaultJoinCodeExpiry / isJoinCodeExpired", () => {
  it("defaults to 24h from now", () => {
    expect(JOIN_CODE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    const now = Date.now();
    expect(defaultJoinCodeExpiry(now).getTime()).toBe(now + JOIN_CODE_TTL_MS);
  });

  it("treats past, missing, and malformed expiries as expired", () => {
    expect(isJoinCodeExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isJoinCodeExpired(null)).toBe(true);
    expect(isJoinCodeExpired(undefined)).toBe(true);
    expect(isJoinCodeExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});

describe("normalizeJoinCodeInput", () => {
  it("uppercases and strips separators", () => {
    expect(normalizeJoinCodeInput(" ab-12_cd ")).toBe("AB12CD");
    expect(normalizeJoinCodeInput("AB12CD")).toBe("AB12CD");
    expect(normalizeJoinCodeInput("")).toBe("");
    expect(normalizeJoinCodeInput(null)).toBe("");
    expect(normalizeJoinCodeInput(123)).toBe("");
  });
});

describe("sanitizeJudgeName", () => {
  it("trims and strips control characters", () => {
    expect(sanitizeJudgeName("  Takeshi  ")).toBe("Takeshi");
    expect(sanitizeJudgeName("A\u0000B\u0007C")).toBe("ABC");
  });

  it("rejects empty, too-long, and non-string names", () => {
    expect(sanitizeJudgeName("")).toBeNull();
    expect(sanitizeJudgeName("   ")).toBeNull();
    expect(sanitizeJudgeName("x".repeat(41))).toBeNull();
    expect(sanitizeJudgeName("x".repeat(40))).toBe("x".repeat(40));
    expect(sanitizeJudgeName(null)).toBeNull();
    expect(sanitizeJudgeName(42)).toBeNull();
  });
});

describe("lowestFreeSeat", () => {
  it("picks the lowest free seat", () => {
    expect(lowestFreeSeat([], 5)).toBe(1);
    expect(lowestFreeSeat([1, 2, 4], 5)).toBe(3);
    expect(lowestFreeSeat([2, 3], 5)).toBe(1);
  });

  it("returns null when the panel is full", () => {
    expect(lowestFreeSeat([1, 2, 3, 4, 5], 5)).toBeNull();
  });

  it("ignores out-of-range and non-integer entries defensively", () => {
    expect(lowestFreeSeat([0, 6, 99, null, undefined], 5)).toBe(1);
    expect(lowestFreeSeat([1, 1, 2, 2], 3)).toBe(3);
  });
});

describe("resolvePanelSize", () => {
  it("honours an explicit positive panel size", () => {
    expect(resolvePanelSize(3, "GROUPS_THEN_ELIMINATION")).toBe(3);
    expect(resolvePanelSize(7, null)).toBe(7);
  });

  it("defaults to 7 for round-robin group formats, else 5", () => {
    expect(resolvePanelSize(null, "GROUPS_THEN_ELIMINATION")).toBe(7);
    expect(resolvePanelSize(null, "ROUND_ROBIN")).toBe(7);
    expect(resolvePanelSize(null, "SINGLE_ELIM_REPECHAGE")).toBe(5);
    expect(resolvePanelSize(null, null)).toBe(5);
    expect(resolvePanelSize(undefined, undefined)).toBe(5);
  });

  it("ignores non-positive explicit sizes", () => {
    expect(resolvePanelSize(0, "ROUND_ROBIN")).toBe(7);
    expect(resolvePanelSize(-2, null)).toBe(5);
  });
});
