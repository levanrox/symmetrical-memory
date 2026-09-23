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

describe("computeBoutDecisionFromRows extras (M2/M4)", () => {
  // 5-seat panel: judges j1..j5 in seats 1..5, all voting AKA 8.0/7.0.
  const cleanSweep = (ids: [string, string, string, string, string]) =>
    ids.flatMap((id) => [row(id, "AKA", 80), row(id, "AO", 70)]);

  it("M2: ignores stale marks from a revoked judge (seat reused)", () => {
    // Seat 1 first held by old-judge (revoked mid-bout); the replacement
    // new-judge now holds seat 1. Both submitted marks for both sides.
    const rows = [
      { ...row("old-judge", "AKA", 60), seatNumber: 1 },
      { ...row("old-judge", "AO", 90), seatNumber: 1 },
      { ...row("new-judge", "AKA", 80), seatNumber: 1 },
      { ...row("new-judge", "AO", 70), seatNumber: 1 },
      { ...row("j2", "AKA", 81), seatNumber: 2 },
      { ...row("j2", "AO", 71), seatNumber: 2 },
      { ...row("j3", "AKA", 82), seatNumber: 3 },
      { ...row("j3", "AO", 72), seatNumber: 3 },
    ];
    const out = computeBoutDecisionFromRows(rows, {}, {
      currentBySeat: new Map([
        [1, "new-judge"],
        [2, "j2"],
        [3, "j3"],
      ]),
    });
    // old-judge's pro-AO marks are excluded: AKA wins 3-0, not 2-1.
    expect(out.winner).toBe("AKA");
    expect(out.akaVotes).toBe(3);
    expect(out.aoVotes).toBe(0);
    expect(out.judgesCounted).toBe(3);
  });

  it("M4: a disqualification overrides a unanimous vote", () => {
    const rows = cleanSweep(["j1", "j2", "j3", "j4", "j5"]);
    const out = computeBoutDecisionFromRows(rows, {}, {
      disqualifiedSide: "AKA",
    });
    expect(out.winner).toBe("AO");
    expect(out.method).toBe("DISQUALIFICATION");
    expect(out.akaTotal).toBe(0);
  });

  it("M4: a scoreless disqualification still resolves", () => {
    const out = computeBoutDecisionFromRows([], {}, {
      disqualifiedSide: "AO",
    });
    expect(out.winner).toBe("AKA");
    expect(out.method).toBe("DISQUALIFICATION");
  });

  it("legacy calls without extras keep the old behavior", () => {
    const rows = cleanSweep(["j1", "j2", "j3", "j4", "j5"]);
    const out = computeBoutDecisionFromRows(rows);
    expect(out.winner).toBe("AKA");
    expect(out.method).toBe("MAJORITY");
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

  it("seeds advancers into bracket positions: position p hosts seed seedPositions(size)[p]", () => {
    // 4 slots -> seedPositions(4) = [1,4,2,3]: m1 hosts seeds 1+4, m2/m3 host 2/3.
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
      { matchId: "m1", position: 1, athleteId: "a" }, // seed 1 <- 1st advancer
      { matchId: "m1", position: 2, athleteId: "d" }, // seed 4 <- 4th advancer
      { matchId: "m2", position: 1, athleteId: "b" }, // seed 2 <- 2nd advancer
      { matchId: "m3", position: 1, athleteId: "c" }, // seed 3 <- 3rd advancer
    ]);
  });

  it("pairs group winners against the opposite group's runners-up (M3)", () => {
    // Two quarter-finals, advancers strongest-first: winners then runners-up.
    // QF1 must be W1 vs R2 and QF2 W2 vs R1 — never W1 vs R1.
    const plan = planEliminationFillIn(
      [
        slot("qf1", 1, 1, null),
        slot("qf1", 1, 2, null),
        slot("qf2", 2, 1, null),
        slot("qf2", 2, 2, null),
      ],
      ["w1", "w2", "r1", "r2"]
    );
    expect(plan).toEqual([
      { matchId: "qf1", position: 1, athleteId: "w1" },
      { matchId: "qf1", position: 2, athleteId: "r2" },
      { matchId: "qf2", position: 1, athleteId: "w2" },
      { matchId: "qf2", position: 2, athleteId: "r1" },
    ]);
  });

  it("skips filled slots and non-ATHLETE slots", () => {
    const plan = planEliminationFillIn(
      [
        slot("m1", 1, 1, "seeded"),
        slot("m1", 1, 2, null),
        slot("m2", 2, 1, null, "BYE"),
        slot("m2", 2, 2, null),
      ],
      // seedPositions(4) = [1,4,2,3]: the only fillable slot with a
      // matching advancer is m1p1 (seed 1) — but it is already filled,
      // so nothing is planned.
      ["a"]
    );
    expect(plan).toEqual([]);
  });

  it("fills by seed position, not by fill order, on a short advancer list", () => {
    const plan = planEliminationFillIn(
      [
        slot("m1", 1, 1, null),
        slot("m1", 1, 2, null),
        slot("m2", 2, 1, null),
        slot("m2", 2, 2, null),
      ],
      ["a"]
    );
    // Only the seed-1 slot is fillable from a single advancer.
    expect(plan).toEqual([{ matchId: "m1", position: 1, athleteId: "a" }]);
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
