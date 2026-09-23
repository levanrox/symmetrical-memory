/**
 * Unit tests for the judge scoring pipeline (src/lib/judge/scores.ts).
 *
 * Pure functions only: score/side parsing, judge-input mapping for P1's
 * majority algorithm, the idempotent write plan, and the authorization scope
 * check. No DB access.
 */

import { describe, expect, it } from "vitest";
import {
  assertJudgeScoreScope,
  countCompleteVotes,
  kataScoresToJudgeInputs,
  parseKataSide,
  planScoreWrite,
  scoreToTenths,
} from "./scores";

describe("scoreToTenths", () => {
  it("accepts the P1 kata range 5.0-10.0 as integer tenths", () => {
    expect(scoreToTenths(5.0)).toBe(50);
    expect(scoreToTenths("7.5")).toBe(75);
    expect(scoreToTenths(10.0)).toBe(100);
    expect(scoreToTenths(" 8.2 ")).toBe(82);
  });

  it("rejects out-of-range and malformed scores", () => {
    expect(() => scoreToTenths(4.9)).toThrow("5.0-10.0");
    expect(() => scoreToTenths(10.1)).toThrow("5.0-10.0");
    expect(() => scoreToTenths(0)).toThrow("5.0-10.0");
  });

  it("rejects >1 decimal place, NaN, and non-numbers (P1 shared rule)", () => {
    expect(() => scoreToTenths(7.55)).toThrow("5.0-10.0");
    expect(() => scoreToTenths("7.55")).toThrow("5.0-10.0");
    expect(() => scoreToTenths(NaN)).toThrow();
    expect(() => scoreToTenths("abc")).toThrow();
    expect(() => scoreToTenths(null)).toThrow();
    expect(() => scoreToTenths(undefined)).toThrow();
  });
});

describe("parseKataSide", () => {
  it("parses AKA/AO case-insensitively with whitespace", () => {
    expect(parseKataSide("aka")).toBe("AKA");
    expect(parseKataSide(" AO ")).toBe("AO");
    expect(parseKataSide("AKA")).toBe("AKA");
  });

  it("rejects anything else", () => {
    expect(() => parseKataSide("RED")).toThrow("side");
    expect(() => parseKataSide("")).toThrow("side");
    expect(() => parseKataSide(null)).toThrow("side");
  });
});

describe("kataScoresToJudgeInputs", () => {
  it("groups rows per judge and passes votes to P1's algorithm", () => {
    const inputs = kataScoresToJudgeInputs([
      { judgeRequestId: "j1", seatNumber: 1, side: "AKA", scoreTenths: 75 },
      { judgeRequestId: "j1", seatNumber: 1, side: "AO", scoreTenths: 70 },
      { judgeRequestId: "j2", seatNumber: 2, side: "AKA", scoreTenths: 80 },
      { judgeRequestId: "j2", seatNumber: 2, side: "AO", scoreTenths: 78 },
    ]);
    expect(inputs).toEqual([
      { judgeId: "j1", aka: 7.5, ao: 7.0 },
      { judgeId: "j2", aka: 8.0, ao: 7.8 },
    ]);
  });

  it("excludes half-votes: a judge missing one side contributes null for it", () => {
    // Half-votes are excluded by P1 (decideKataBout skips any judge with
    // aka or ao null) — one-sided marks must not sway the decision.
    const inputs = kataScoresToJudgeInputs([
      { judgeRequestId: "j1", seatNumber: 1, side: "AKA", scoreTenths: 75 },
    ]);
    expect(inputs).toEqual([{ judgeId: "j1", aka: 7.5, ao: null }]);
  });

  it("converts tenths back to fractional scores exactly", () => {
    const inputs = kataScoresToJudgeInputs([
      { judgeRequestId: "j1", seatNumber: 1, side: "AO", scoreTenths: 82 },
    ]);
    expect(inputs[0].ao).toBe(8.2);
  });
});

describe("countCompleteVotes", () => {
  it("counts only judges with both sides", () => {
    const rows = [
      { judgeRequestId: "j1", seatNumber: 1, side: "AKA" as const, scoreTenths: 75 },
      { judgeRequestId: "j1", seatNumber: 1, side: "AO" as const, scoreTenths: 70 },
      { judgeRequestId: "j2", seatNumber: 2, side: "AKA" as const, scoreTenths: 80 },
      { judgeRequestId: "j3", seatNumber: 3, side: "AO" as const, scoreTenths: 70 },
    ];
    expect(countCompleteVotes(rows)).toBe(1);
    expect(countCompleteVotes([])).toBe(0);
  });
});

describe("planScoreWrite", () => {
  it("returns duplicate when the idempotency key already exists", () => {
    expect(planScoreWrite({ id: "row-1" }, { id: "row-1" })).toBe("duplicate");
    expect(planScoreWrite({ id: "row-1" }, null)).toBe("duplicate");
  });

  it("returns update for an existing (match, judge, side) row", () => {
    expect(planScoreWrite(null, { id: "row-1" })).toBe("update");
  });

  it("returns insert when nothing exists", () => {
    expect(planScoreWrite(null, null)).toBe("insert");
  });
});

describe("assertJudgeScoreScope", () => {
  const ok = {
    judgeRingId: "ring-1",
    matchRingId: "ring-1",
    matchStatus: "LIVE",
    ringCurrentMatchId: "match-9",
    matchId: "match-9",
  };

  it("passes for the judge's own ring's active live bout", () => {
    expect(() => assertJudgeScoreScope(ok)).not.toThrow();
  });

  it("rejects cross-ring scoring", () => {
    expect(() =>
      assertJudgeScoreScope({ ...ok, judgeRingId: "ring-1", matchRingId: "ring-2" })
    ).toThrow("not running on your ring");
  });

  it("rejects when the bout is not LIVE", () => {
    expect(() =>
      assertJudgeScoreScope({ ...ok, matchStatus: "SCHEDULED" })
    ).toThrow("live bout");
  });

  it("rejects when the bout is not the ring's active bout", () => {
    expect(() =>
      assertJudgeScoreScope({ ...ok, ringCurrentMatchId: "match-10" })
    ).toThrow("active bout");
  });

  it("rejects unassigned categories", () => {
    expect(() => assertJudgeScoreScope({ ...ok, matchRingId: null })).toThrow();
  });
});
