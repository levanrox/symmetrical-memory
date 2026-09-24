import { describe, expect, it } from "vitest";
import {
  buildKataDrawTableView,
  type KataTablePoolBout,
} from "./kataTableView";

const athletes = new Map([
  ["a1", { id: "a1", name: "Aarav Sharma", school: "Dojo One", chestNumber: "101" }],
  ["a2", { id: "a2", name: "Bina Patel", school: "Dojo Two", chestNumber: "102" }],
  ["a3", { id: "a3", name: "Chetan Rao", school: "Dojo One", chestNumber: null }],
  ["a4", { id: "a4", name: "Divya Nair", school: undefined, chestNumber: "104" }],
]);

const snapshot = {
  format: "GROUPS_THEN_ELIMINATION",
  rankingMethod: "WKF_VICTORY_POINTS",
  advancePerGroup: 2,
  randomSeed: 42,
  groups: [
    { id: "g1", name: "Group A", memberIds: ["a1", "a2", "a3", "a4"] },
  ],
};

function poolBout(overrides: Partial<KataTablePoolBout> & { matchId: string }): KataTablePoolBout {
  return {
    matchNo: 1,
    roundLabel: "Group A · Round 1",
    groupId: "g1",
    akaId: null,
    aoId: null,
    akaScore: null,
    aoScore: null,
    winnerId: null,
    status: "SCHEDULED",
    ...overrides,
  };
}

describe("buildKataDrawTableView", () => {
  it("returns null when there is no group snapshot", () => {
    expect(buildKataDrawTableView({ snapshot: null, athletes, poolBouts: [], standingsByGroup: new Map() })).toBeNull();
    expect(
      buildKataDrawTableView({
        snapshot: { ...snapshot, format: "SINGLE_ELIM_REPECHAGE" },
        athletes,
        poolBouts: [],
        standingsByGroup: new Map(),
      })
    ).toBeNull();
    expect(
      buildKataDrawTableView({
        snapshot: { format: "GROUPS_THEN_ELIMINATION", groups: "nope" },
        athletes,
        poolBouts: [],
        standingsByGroup: new Map(),
      })
    ).toBeNull();
  });

  it("builds one table per group with every participant named", () => {
    const view = buildKataDrawTableView({
      snapshot,
      athletes,
      poolBouts: [],
      standingsByGroup: new Map(),
    });
    expect(view?.format).toBe("GROUPS_THEN_ELIMINATION");
    expect(view?.groups).toHaveLength(1);
    expect(view?.groups[0]?.members.map((m) => m.name)).toEqual([
      "Aarav Sharma",
      "Bina Patel",
      "Chetan Rao",
      "Divya Nair",
    ]);
  });

  it("attaches each member's bouts with scores, opponents and W/L", () => {
    const view = buildKataDrawTableView({
      snapshot,
      athletes,
      poolBouts: [
        poolBout({ matchId: "m1", matchNo: 1, akaId: "a1", aoId: "a2", akaScore: 21.5, aoScore: 19.0, winnerId: "a1", status: "CONFIRMED" }),
        poolBout({ matchId: "m2", matchNo: 2, akaId: "a3", aoId: "a4", akaScore: null, aoScore: null, winnerId: null, status: "SCHEDULED" }),
      ],
      standingsByGroup: new Map(),
    });
    const aarav = view?.groups[0]?.members.find((m) => m.id === "a1");
    expect(aarav?.bouts).toHaveLength(1);
    expect(aarav?.bouts[0]).toMatchObject({
      matchId: "m1",
      matchNo: 1,
      opponentName: "Bina Patel",
      score: 21.5,
      opponentScore: 19.0,
      won: true,
      status: "CONFIRMED",
    });
    const bina = view?.groups[0]?.members.find((m) => m.id === "a2");
    expect(bina?.bouts[0]).toMatchObject({ score: 19.0, opponentScore: 21.5, won: false });
    // Unscored bout: null scores, null won.
    const chetan = view?.groups[0]?.members.find((m) => m.id === "a3");
    expect(chetan?.bouts[0]).toMatchObject({ score: null, won: null });
  });

  it("applies official standings for rank, points, total and qualifiers", () => {
    const view = buildKataDrawTableView({
      snapshot,
      athletes,
      poolBouts: [],
      standingsByGroup: new Map([
        [
          "g1",
          [
            { registrationId: "a2", rank: 1, wins: 3, victoryPoints: 9, votesFor: 12, scoreFor: 64.5 },
            { registrationId: "a1", rank: 2, wins: 2, victoryPoints: 6, votesFor: 9, scoreFor: 61.0 },
            { registrationId: "a4", rank: 3, wins: 1, victoryPoints: 3, votesFor: 5, scoreFor: 58.5 },
            { registrationId: "a3", rank: 4, wins: 0, victoryPoints: 0, votesFor: 2, scoreFor: 55.0 },
          ],
        ],
      ]),
    });
    const members = view?.groups[0]?.members ?? [];
    // Official order, not snapshot order.
    expect(members.map((m) => m.id)).toEqual(["a2", "a1", "a4", "a3"]);
    expect(members[0]).toMatchObject({ rank: 1, points: 9, totalScore: 64.5, wins: 3, qualified: true });
    expect(members[1]).toMatchObject({ rank: 2, qualified: true });
    expect(members[2]).toMatchObject({ rank: 3, qualified: false });
  });

  it("falls back to snapshot order with zeroes before any bout is confirmed", () => {
    const view = buildKataDrawTableView({
      snapshot,
      athletes,
      poolBouts: [],
      standingsByGroup: new Map(),
    });
    const members = view?.groups[0]?.members ?? [];
    expect(members.map((m) => m.rank)).toEqual([1, 2, 3, 4]);
    expect(members.every((m) => m.points === 0 && m.totalScore === 0)).toBe(true);
    // Top-2 still flagged from the fallback ranks.
    expect(members[0]?.qualified).toBe(true);
    expect(members[1]?.qualified).toBe(true);
    expect(members[2]?.qualified).toBe(false);
  });

  it("never marks qualifiers for pure round robin", () => {
    const view = buildKataDrawTableView({
      snapshot: { ...snapshot, format: "ROUND_ROBIN" },
      athletes,
      poolBouts: [],
      standingsByGroup: new Map(),
    });
    expect(view?.format).toBe("ROUND_ROBIN");
    expect(view?.groups[0]?.members.every((m) => m.qualified === false)).toBe(true);
  });

  it("names unknown athletes instead of dropping them", () => {
    const view = buildKataDrawTableView({
      snapshot: {
        ...snapshot,
        groups: [{ id: "g1", name: "Group A", memberIds: ["ghost"] }],
      },
      athletes,
      poolBouts: [],
      standingsByGroup: new Map(),
    });
    expect(view?.groups[0]?.members[0]?.name).toBe("Unknown athlete");
  });

  it("passes through per-match score sums for the finals table", () => {
    const scoresByMatch = { m9: { aka: 22.0, ao: null } };
    const view = buildKataDrawTableView({
      snapshot,
      athletes,
      poolBouts: [],
      standingsByGroup: new Map(),
      scoresByMatch,
    });
    expect(view?.scoresByMatch).toEqual(scoresByMatch);
  });
});
