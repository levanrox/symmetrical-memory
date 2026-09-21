/**
 * Unit tests for the bout-confirmation decision logic
 * (resolveConfirmOutcome in src/actions/matches.ts).
 *
 * This pure function decides idempotency vs conflict when a moderator
 * confirms a bout result; it must never allow a second, different result
 * to silently overwrite a confirmed one.
 */

import { describe, expect, it } from "vitest";
import { resolveConfirmOutcome, assertMatchRingBinding, clampScore } from "@/lib/boutGuards";

describe("resolveConfirmOutcome", () => {
  it("proceeds when the bout is not yet confirmed", () => {
    expect(resolveConfirmOutcome("SCHEDULED", null, "aka-id")).toBe("proceed");
    expect(resolveConfirmOutcome("LIVE", null, "aka-id")).toBe("proceed");
    expect(resolveConfirmOutcome(null, null, "aka-id")).toBe("proceed");
    expect(resolveConfirmOutcome(undefined, undefined, "aka-id")).toBe(
      "proceed"
    );
  });

  it("proceeds even if a winner was set without CONFIRMED status", () => {
    expect(resolveConfirmOutcome("LIVE", "ao-id", "aka-id")).toBe("proceed");
  });

  it("returns duplicate when re-confirming the same winner", () => {
    expect(resolveConfirmOutcome("CONFIRMED", "aka-id", "aka-id")).toBe(
      "duplicate"
    );
  });

  it("returns conflict when a different winner is confirmed over CONFIRMED", () => {
    expect(resolveConfirmOutcome("CONFIRMED", "aka-id", "ao-id")).toBe(
      "conflict"
    );
  });

  it("proceeds when CONFIRMED but no winner was recorded (admin repair)", () => {
    // Legacy/incomplete rows can be CONFIRMED with a null winner; setting
    // the winner then must not be blocked as a "conflict".
    expect(resolveConfirmOutcome("CONFIRMED", null, "ao-id")).toBe("proceed");
    expect(resolveConfirmOutcome("CONFIRMED", undefined, "ao-id")).toBe(
      "proceed"
    );
  });

  it("is case-sensitive on status", () => {
    expect(resolveConfirmOutcome("confirmed", "aka-id", "aka-id")).toBe(
      "proceed"
    );
  });
});

/**
 * Unit tests for assertMatchRingBinding (H1 fix) and clampScore (L6 fix).
 */
describe("assertMatchRingBinding", () => {
  it("passes when the match's ring equals the caller's ring claim", () => {
    expect(() => assertMatchRingBinding("ring-a", "ring-a")).not.toThrow();
  });

  it("throws when the caller claims a different ring than the match's", () => {
    // Ring-A moderator passes ring A's id while targeting a ring-B match.
    expect(() => assertMatchRingBinding("ring-b", "ring-a")).toThrow(
      "Match does not belong to this ring"
    );
  });

  it("throws when the match has no ring assignment but a ring was claimed", () => {
    expect(() => assertMatchRingBinding(null, "ring-a")).toThrow(
      "Match is not currently assigned to a ring"
    );
  });

  it("does nothing when the caller made no ring claim (admin/organiser path)", () => {
    expect(() => assertMatchRingBinding("ring-b", null)).not.toThrow();
    expect(() => assertMatchRingBinding("ring-b", undefined)).not.toThrow();
    expect(() => assertMatchRingBinding(null, null)).not.toThrow();
  });
});

describe("clampScore", () => {
  it("accepts integers 0–99", () => {
    expect(clampScore(0, "akaScore")).toBe(0);
    expect(clampScore(99, "aoScore")).toBe(99);
    expect(clampScore(7, "akaPenalties")).toBe(7);
  });

  it("treats null/undefined as 0", () => {
    expect(clampScore(null, "akaScore")).toBe(0);
    expect(clampScore(undefined, "aoScore")).toBe(0);
  });

  it("rejects out-of-range, fractional, and non-finite values", () => {
    expect(() => clampScore(-1, "akaScore")).toThrow("Invalid akaScore");
    expect(() => clampScore(100, "aoScore")).toThrow("Invalid aoScore");
    expect(() => clampScore(1.5, "akaScore")).toThrow();
    expect(() => clampScore(NaN, "akaScore")).toThrow();
    expect(() => clampScore(Infinity, "akaScore")).toThrow();
  });
});
