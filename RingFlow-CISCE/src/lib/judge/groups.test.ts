/**
 * Unit tests for the kata group-stage plumbing (src/lib/judge/groups.ts).
 *
 * The only pure piece is `toGroupBoutResults` (DB loading lives in
 * `recomputeGroupStandings` / `fillEliminationBracket`). This also exercises
 * the pure end-to-end chain it feeds: fabricated group bouts ->
 * `toGroupBoutResults` -> P2 `rankGroupAthletes` -> `advanceToElimination` ->
 * `planEliminationFillIn` (no DB access anywhere here).
 */

import { describe, expect, it } from "vitest";
import { toGroupBoutResults } from "./groups";
import { planEliminationFillIn } from "./decision";
import {
  advanceToElimination,
  rankGroupAthletes,
  type KataGroup,
} from "@/lib/draws/kataDraws";
import type { KataScoreRow } from "./scores";

const score = (
  judgeRequestId: string,
  side: "AKA" | "AO",
  scoreTenths: number
): KataScoreRow => ({ judgeRequestId, seatNumber: 1, side, scoreTenths });

/** A bout where every judge voted for `winnerSide` with fixed marks. */
function unanimousBout(
  matchId: string,
  groupId: string,
  akaId: string,
  aoId: string,
  winnerSide: "AKA" | "AO",
  akaTenths = 75,
  aoTenths = 70
) {
  const win = winnerSide === "AKA" ? akaTenths : aoTenths;
  const lose = winnerSide === "AKA" ? aoTenths : akaTenths;
  const scores: KataScoreRow[] = [];
  for (let j = 1; j <= 3; j += 1) {
    scores.push(score(`j${j}`, "AKA", win));
    scores.push(score(`j${j}`, "AO", lose));
  }
  return {
    matchId,
    groupId,
    akaId,
    aoId,
    winnerId: winnerSide === "AKA" ? akaId : aoId,
    scores,
  };
}

const kataGroup = (id: string, memberIds: string[]): KataGroup => ({
  id,
  name: id,
  members: memberIds.map((registrationId) => ({
    registrationId,
    displayName: "",
    clubId: "",
    districtId: null,
    seed: null,
  })),
});

describe("toGroupBoutResults", () => {
  it("recomputes votes and totals from the stored scores", () => {
    const results = toGroupBoutResults([
      unanimousBout("m1", "g1", "a", "b", "AKA"),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      groupId: "g1",
      akaId: "a",
      aoId: "b",
      winnerId: "a",
      akaVotes: 3,
      aoVotes: 0,
      akaScore: 22.5, // 3 judges x 7.5
      aoScore: 21.0, // 3 judges x 7.0
    });
  });

  it("skips bouts missing an athlete or a winner", () => {
    const good = unanimousBout("m1", "g1", "a", "b", "AKA");
    const missing = { ...good, matchId: "m2", akaId: null as unknown as string };
    const noWinner = { ...good, matchId: "m3", winnerId: null as unknown as string };
    expect(toGroupBoutResults([good, missing, noWinner])).toHaveLength(1);
  });

  it("still records the win when votes cannot be computed", () => {
    const results = toGroupBoutResults([
      {
        matchId: "m1",
        groupId: "g1",
        akaId: "a",
        aoId: "b",
        winnerId: "a",
        scores: [], // confirmed without countable votes (defensive path)
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ winnerId: "a", akaVotes: 0, akaScore: 0 });
  });
});

describe("group stage -> elimination fill-in (pure chain)", () => {
  it("ranks round-robin groups and fills TBD elimination slots in bracket order", () => {
    // Two groups of three. In each: a beats b, b beats c, a beats c.
    const bouts = [
      unanimousBout("m1", "g1", "a1", "b1", "AKA"),
      unanimousBout("m2", "g1", "b1", "c1", "AKA"),
      unanimousBout("m3", "g1", "a1", "c1", "AKA"),
      unanimousBout("m4", "g2", "b2", "a2", "AO"), // a2 wins as AO
      unanimousBout("m5", "g2", "b2", "c2", "AKA"),
      unanimousBout("m6", "g2", "c2", "a2", "AO"), // a2 wins as AO
    ];
    const results = toGroupBoutResults(bouts);

    const rankedG1 = rankGroupAthletes(
      kataGroup("g1", ["a1", "b1", "c1"]),
      results.filter((r) => r.groupId === "g1"),
      "WKF_VICTORY_POINTS"
    );
    const rankedG2 = rankGroupAthletes(
      kataGroup("g2", ["a2", "b2", "c2"]),
      results.filter((r) => r.groupId === "g2"),
      "WKF_VICTORY_POINTS"
    );
    expect(rankedG1.map((a) => a.registrationId)).toEqual(["a1", "b1", "c1"]);
    expect(rankedG2.map((a) => a.registrationId)).toEqual(["a2", "b2", "c2"]);

    // Top 2 per group advance: winners first, then runners-up.
    const advancers = advanceToElimination([rankedG1, rankedG2], 2);
    expect(advancers).toEqual(["a1", "a2", "b1", "b2"]);

    const plan = planEliminationFillIn(
      [
        { matchId: "q1", matchNo: 1, position: 1, slotType: "ATHLETE", athleteId: null },
        { matchId: "q1", matchNo: 1, position: 2, slotType: "ATHLETE", athleteId: null },
        { matchId: "q2", matchNo: 2, position: 1, slotType: "ATHLETE", athleteId: null },
        { matchId: "q2", matchNo: 2, position: 2, slotType: "ATHLETE", athleteId: null },
      ],
      advancers
    );
    expect(plan).toEqual([
      { matchId: "q1", position: 1, athleteId: "a1" },
      { matchId: "q1", position: 2, athleteId: "a2" },
      { matchId: "q2", position: 1, athleteId: "b1" },
      { matchId: "q2", position: 2, athleteId: "b2" },
    ]);
  });
});
