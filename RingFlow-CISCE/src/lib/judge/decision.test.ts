/**
 * Unit tests for kata decision math (src/lib/judge/decision.ts).
 *
 * Pure functions only: the decision bridge from stored score rows to P1's
 * `decideKataBout`, the DB enum mapping, and the elimination fill-in plan.
 * No DB access.
 */

import { describe, expect, it } from "vitest";
import {
  KATA_DECISION_METHODS,
  KataDecisionError,
  computeBoutDecisionFromRows,
  planEliminationFillIn,
  type PlaceholderSlot,
} from "./decision";
import type { KataScoreRow } from "./scores";

const row = (
  judgeRequestId: string,
  side: "AKA" | "AO",
  scoreTenths: number
): KataScoreRow => ({
  judgeRequestId,
  seatNumber: 1,
  side,
  scoreTenths,
});

describe("computeBoutDecisionFromRows", () => {
  it("decides a clean majority from stored rows", () => {
    // 5-seat panel: 3 judges vote AKA, 2 vote AO.
    const rows = [
      row("j1", "AKA", 75), row("j1", "AO", 70),
      row("j2", "AKA", 80), row("j2", "AO", 72),
      row("j3", "AKA", 71), row("j3", "AO", 70),
      row("j4", "AKA", 68), row("j4", "AO", 77),
      row("j5", "AKA", 66), row("j5", "AO", 79),
    ];
    const out = computeBoutDecisionFromRows(rows);
    expect(out.winner).toBe("AKA");
    expect(out.akaVotes).toBe(3);
    expect(out.aoVotes).toBe(2);
    expect(out.method).toBe("MAJORITY");
    expect(out.judgesCounted).toBe(5);
  });

  it("excludes half-votes from the count (P1 rule)", () => {
    // j3 only marked AKA: their partial vote is dropped — AKA 2, AO 1,
    // but j3's mark still feeds nothing since their vote is uncounted.
    const rows = [
      row("j1", "AKA", 75), row("j1", "AO", 70),
      row("j2", "AKA", 80), row("j2", "AO", 72),
      row("j3", "AKA", 99),
      row("j4", "AKA", 66), row("j4", "AO", 79),
    ];
    const out = computeBoutDecisionFromRows(rows);
    expect(out.winner).toBe("AKA");
    expect(out.akaVotes).toBe(2);
    expect(out.aoVotes).toBe(1);
    expect(out.judgesCounted).toBe(3);
  });

  it("does not count a judge's vote when their marks are equal", () => {
    const rows = [
      row("j1", "AKA", 75), row("j1", "AO", 75), // no vote, but marks feed totals
      row("j2", "AKA", 80), row("j2", "AO", 70), // AKA vote
    ];
    const out = computeBoutDecisionFromRows(rows);
    expect(out.winner).toBe("AKA");
    expect(out.akaVotes).toBe(1);
    expect(out.aoVotes).toBe(0);
    expect(out.judgesCounted).toBe(2);
    expect(out.akaTotal).toBeCloseTo(15.5, 5);
    expect(out.aoTotal).toBeCloseTo(14.5, 5);
  });

  it("resolves tied votes via total score (Art. 5.5.1 tiebreak ladder)", () => {
    const rows = [
      row("j1", "AKA", 76), row("j1", "AO", 70), // AKA vote
      row("j2", "AKA", 70), row("j2", "AO", 75), // AO vote
    ];
    const out = computeBoutDecisionFromRows(rows);
    expect(out.winner).toBe("AKA");
    expect(out.method).toBe("TOTAL_SCORE_TIEBREAK");
    expect(out.akaVotes).toBe(1);
    expect(out.aoVotes).toBe(1);
    expect(out.akaTotal).toBeCloseTo(14.6, 5);
    expect(out.aoTotal).toBeCloseTo(14.5, 5);
  });

  it("throws KataDecisionError when votes AND totals tie with no HANTEI", () => {
    const rows = [
      row("j1", "AKA", 75), row("j1", "AO", 70),
      row("j2", "AKA", 70), row("j2", "AO", 75),
    ];
    expect(() => computeBoutDecisionFromRows(rows)).toThrow(KataDecisionError);
    expect(() => computeBoutDecisionFromRows(rows)).toThrow(
      "moderator decision is required"
    );
  });

  it("accepts the moderator's HANTEI decision after a full tie", () => {
    const rows = [
      row("j1", "AKA", 75), row("j1", "AO", 70),
      row("j2", "AKA", 70), row("j2", "AO", 75),
    ];
    const out = computeBoutDecisionFromRows(rows, { moderatorDecision: "AO" });
    expect(out.winner).toBe("AO");
    expect(out.method).toBe("MODERATOR");
  });

  it("throws when there are no countable votes", () => {
    expect(() => computeBoutDecisionFromRows([])).toThrow(KataDecisionError);
    // Only half-votes: nothing countable.
    expect(() =>
      computeBoutDecisionFromRows([
        row("j1", "AKA", 75),
        row("j2", "AO", 80),
      ])
    ).toThrow(KataDecisionError);
  });
});

describe("KATA_DECISION_METHODS", () => {
  it("maps the engine methods to matches.decision_method values", () => {
    expect(KATA_DECISION_METHODS).toEqual({
      MAJORITY: "KATA_MAJORITY",
      TOTAL_SCORE_TIEBREAK: "KATA_TOTAL_SCORE_TIEBREAK",
      MODERATOR: "KATA_MODERATOR",
      DISQUALIFICATION: "KATA_DISQUALIFICATION",
    });
  });
});

describe("planEliminationFillIn", () => {
  const slot = (
    matchId: string,
    matchNo: number,
    position: 1 | 2,
    athleteId: string | null,
    slotType = "ATHLETE"
  ): PlaceholderSlot => ({ matchId, matchNo, position, slotType, athleteId });

  it("assigns advancers to empty ATHLETE slots in bracket order", () => {
    const plan = planEliminationFillIn(
      [
        slot("m2", 2, 1, null),
        slot("m1", 1, 2, null),
        slot("m1", 1, 1, null),
        slot("m3", 3, 1, null),
      ],
      ["a", "b", "c", "d"]
    );
    expect(plan).toEqual([
      { matchId: "m1", position: 1, athleteId: "a" },
      { matchId: "m1", position: 2, athleteId: "b" },
      { matchId: "m2", position: 1, athleteId: "c" },
      { matchId: "m3", position: 1, athleteId: "d" },
    ]);
  });

  it("skips filled slots and non-ATHLETE slots, and stops on a short list", () => {
    const plan = planEliminationFillIn(
      [
        slot("m1", 1, 1, "seeded"),
        slot("m1", 1, 2, null),
        slot("m2", 2, 1, null, "BYE"),
        slot("m2", 2, 2, null),
      ],
      ["a"]
    );
    // m1p1 filled, m2p1 is a BYE placeholder — only m1p2 is fillable,
    // and the advancer list runs out after it.
    expect(plan).toEqual([{ matchId: "m1", position: 2, athleteId: "a" }]);
  });

  it("is idempotent: a fully-filled bracket produces an empty plan", () => {
    expect(
      planEliminationFillIn([slot("m1", 1, 1, "x"), slot("m1", 1, 2, "y")], ["a"])
    ).toEqual([]);
  });

  it("ignores surplus advancers", () => {
    const plan = planEliminationFillIn([slot("m1", 1, 1, null)], ["a", "b", "c"]);
    expect(plan).toEqual([{ matchId: "m1", position: 1, athleteId: "a" }]);
  });

  it("handles an empty bracket", () => {
    expect(planEliminationFillIn([], ["a"])).toEqual([]);
  });
});
