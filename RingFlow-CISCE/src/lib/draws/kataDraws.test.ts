import { describe, expect, it } from "vitest";
import {
  advanceToElimination,
  buildKataGroups,
  buildKataStageGraph,
  kataFoughtBoutCount,
  parseKataDrawFormat,
  parseKataRankingMethod,
  rankGroupAthletes,
  resolveGroupCount,
  roundRobinBouts,
  wkfGroupCount,
  type KataGroup,
  type KataGroupBoutResult,
  type KataParticipant,
} from "./kataDraws";

function mkParticipants(
  n: number,
  seeds?: (number | null)[]
): KataParticipant[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `athlete-${i + 1}`,
    displayName: `Athlete ${i + 1}`,
    clubId: "Dojo",
    districtId: null,
    seed: seeds ? (seeds[i] ?? null) : null,
  }));
}

function mkGroup(ids: string[]): KataGroup {
  return {
    id: "G1",
    name: "Group A",
    members: ids.map((id) => ({
      registrationId: id,
      displayName: id,
      clubId: "Dojo",
      districtId: null,
      seed: null,
    })),
  };
}

describe("wkfGroupCount (WKF 3.7.9)", () => {
  it.each([
    [32, 8],
    [24, 8],
    [23, 6],
    [17, 6],
    [16, 4],
    [12, 4],
    [11, 3],
    [9, 3],
    [8, 2],
    [6, 2],
    [5, 1],
    [3, 1],
  ])("%i athletes -> %i groups", (athletes, groups) => {
    expect(wkfGroupCount(athletes)).toBe(groups);
  });
});

describe("resolveGroupCount", () => {
  it("honours an explicit athletes-per-group override", () => {
    expect(resolveGroupCount(16, 4)).toBe(4);
    expect(resolveGroupCount(17, 4)).toBe(5); // ceil(17/4)
  });

  it("never creates more groups than athletes", () => {
    expect(resolveGroupCount(3, 1)).toBe(3);
    expect(resolveGroupCount(2, null)).toBe(1);
  });
});

describe("buildKataGroups", () => {
  it.each([
    [32, 8],
    [23, 6],
    [16, 4],
    [11, 3],
    [8, 2],
    [5, 1],
    [3, 1],
  ])("splits %i athletes into %i groups", (n, expected) => {
    const groups = buildKataGroups(mkParticipants(n), {
      randomSeed: 42,
      categoryId: "cat-1",
    });
    expect(groups).toHaveLength(expected);
    const total = groups.reduce((sum, g) => sum + g.members.length, 0);
    expect(total).toBe(n);
  });

  it("keeps group sizes balanced to within one athlete", () => {
    const groups = buildKataGroups(mkParticipants(23), { randomSeed: 7 });
    const sizes = groups.map((g) => g.members.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("distributes the top-4 seeds one per group", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const groups = buildKataGroups(mkParticipants(16, seeds), { randomSeed: 99 });
    expect(groups).toHaveLength(4);
    const seedGroups = new Map<string, number>();
    groups.forEach((g, gi) => {
      for (const m of g.members) {
        if (m.seed != null && m.seed <= 4) seedGroups.set(m.registrationId, gi);
      }
    });
    expect(seedGroups.size).toBe(4);
    expect(new Set(seedGroups.values()).size).toBe(4);
  });

  it("is deterministic for a fixed random seed", () => {
    const a = buildKataGroups(mkParticipants(20), { randomSeed: 1234 });
    const b = buildKataGroups(mkParticipants(20), { randomSeed: 1234 });
    expect(a.map((g) => g.members.map((m) => m.registrationId))).toEqual(
      b.map((g) => g.members.map((m) => m.registrationId))
    );
  });

  it("throws on zero participants", () => {
    expect(() => buildKataGroups([])).toThrow();
  });
});

describe("roundRobinBouts", () => {
  it("pairs everyone exactly once for n=8 (28 bouts)", () => {
    const group = mkGroup(
      Array.from({ length: 8 }, (_, i) => `a${i + 1}`)
    );
    const bouts = roundRobinBouts(group);
    expect(bouts).toHaveLength(28);

    const seen = new Set<string>();
    for (const b of bouts) {
      const key = [b.akaId, b.aoId].sort().join("|");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(28);

    // Everyone fights 7 bouts.
    const counts = new Map<string, number>();
    for (const b of bouts) {
      counts.set(b.akaId, (counts.get(b.akaId) ?? 0) + 1);
      counts.set(b.aoId, (counts.get(b.aoId) ?? 0) + 1);
    }
    expect([...counts.values()].every((c) => c === 7)).toBe(true);
  });

  it("handles odd groups with a bye rotation (n=5 -> 10 bouts)", () => {
    const group = mkGroup(["a", "b", "c", "d", "e"]);
    const bouts = roundRobinBouts(group);
    expect(bouts).toHaveLength(10);
    const seen = new Set(
      bouts.map((b) => [b.akaId, b.aoId].sort().join("|"))
    );
    expect(seen.size).toBe(10);
  });

  it("balances AKA/AO sides across the group", () => {
    const group = mkGroup(
      Array.from({ length: 8 }, (_, i) => `a${i + 1}`)
    );
    const bouts = roundRobinBouts(group);
    const akaCounts = new Map<string, number>();
    const aoCounts = new Map<string, number>();
    for (const b of bouts) {
      akaCounts.set(b.akaId, (akaCounts.get(b.akaId) ?? 0) + 1);
      aoCounts.set(b.aoId, (aoCounts.get(b.aoId) ?? 0) + 1);
    }
    // 7 bouts each: everyone gets 3-4 on each side.
    for (const id of group.members.map((m) => m.registrationId)) {
      expect(akaCounts.get(id)).toBeGreaterThanOrEqual(3);
      expect(akaCounts.get(id)).toBeLessThanOrEqual(4);
      expect(aoCounts.get(id)).toBeGreaterThanOrEqual(3);
      expect(aoCounts.get(id)).toBeLessThanOrEqual(4);
    }
  });
});

describe("rankGroupAthletes — WKF_VICTORY_POINTS", () => {
  const group = mkGroup(["A", "B", "C", "D"]);

  function bout(
    akaId: string,
    aoId: string,
    winnerId: string,
    akaVotes = 5,
    aoVotes = 0,
    akaScore = 25,
    aoScore = 20
  ): KataGroupBoutResult {
    return {
      groupId: "G1",
      akaId,
      aoId,
      winnerId,
      akaVotes,
      aoVotes,
      akaScore,
      aoScore,
    };
  }

  it("ranks by victory points (3 per win)", () => {
    const results = [
      bout("A", "B", "A"),
      bout("A", "C", "A"),
      bout("A", "D", "A"),
      bout("B", "C", "B"),
      bout("B", "D", "B"),
      bout("C", "D", "C"),
    ];
    const ranked = rankGroupAthletes(group, results, "WKF_VICTORY_POINTS");
    expect(ranked.map((r) => r.registrationId)).toEqual(["A", "B", "C", "D"]);
    expect(ranked.map((r) => r.victoryPoints)).toEqual([9, 6, 3, 0]);
  });

  it("breaks a VP tie on head-to-head", () => {
    // A and B both on 6 VP; A beat B directly but has fewer judges' votes.
    const results = [
      bout("A", "B", "A", 3, 2, 21, 20), // A wins narrowly
      bout("A", "C", "A", 5, 0, 25, 20),
      bout("A", "D", "D", 0, 5, 18, 26),
      bout("B", "C", "B", 5, 0, 28, 20),
      bout("B", "D", "B", 5, 0, 28, 20),
      bout("C", "D", "C", 5, 0, 25, 20),
    ];
    const ranked = rankGroupAthletes(group, results, "WKF_VICTORY_POINTS");
    const order = ranked.map((r) => r.registrationId);
    // A and B tie on 6 VP; head-to-head puts A first despite B's extra votes.
    // C and D tie on 3 VP; C beat D directly.
    expect(order).toEqual(["A", "B", "C", "D"]);
  });

  it("falls through a head-to-head cycle to judges' votes", () => {
    // A>B, B>C, C>A: all on 6 VP; votes decide.
    const results = [
      bout("A", "B", "A", 5, 0, 25, 20),
      bout("B", "C", "B", 5, 0, 25, 20),
      bout("C", "A", "C", 3, 2, 21, 20),
      bout("A", "D", "A", 5, 0, 25, 20),
      bout("B", "D", "B", 5, 0, 25, 20),
      bout("C", "D", "C", 5, 0, 25, 20),
    ];
    const ranked = rankGroupAthletes(group, results, "WKF_VICTORY_POINTS");
    expect(ranked.map((r) => r.registrationId)).toEqual(["A", "B", "C", "D"]);
    // votesFor: A=5+2+5=12, B=0+5+5=10, C=0+3+5=8
    expect(ranked.map((r) => r.votesFor)).toEqual([12, 10, 8, 0]);
  });

  it("uses total score sum after judges' votes", () => {
    const results = [
      bout("A", "B", "A", 5, 0, 25, 20),
      bout("B", "C", "B", 5, 0, 25, 20),
      bout("C", "A", "C", 5, 0, 25, 20), // cycle, equal votes this time
      bout("A", "D", "A", 5, 0, 30, 20), // A banks a big score
      bout("B", "D", "B", 5, 0, 25, 20),
      bout("C", "D", "C", 5, 0, 25, 20),
    ];
    const ranked = rankGroupAthletes(group, results, "WKF_VICTORY_POINTS");
    expect(ranked.map((r) => r.registrationId)).toEqual(["A", "B", "C", "D"]);
  });

  it("ignores bouts from other groups and invalid winners", () => {
    const results = [
      bout("A", "B", "A"),
      { ...bout("A", "C", "A"), groupId: "G2" },
      { ...bout("B", "C", "B"), winnerId: "ZZZ" },
    ];
    const ranked = rankGroupAthletes(group, results, "WKF_VICTORY_POINTS");
    expect(ranked.find((r) => r.registrationId === "A")?.victoryPoints).toBe(3);
    expect(ranked.find((r) => r.registrationId === "B")?.victoryPoints).toBe(0);
  });
});

describe("rankGroupAthletes — TOTAL_SCORE", () => {
  it("ranks by total score sum regardless of wins", () => {
    const group = mkGroup(["A", "B", "C"]);
    const results: KataGroupBoutResult[] = [
      // A wins both bouts but with modest scores.
      { groupId: "G1", akaId: "A", aoId: "B", winnerId: "A", akaVotes: 3, aoVotes: 2, akaScore: 21, aoScore: 20 },
      { groupId: "G1", akaId: "A", aoId: "C", winnerId: "A", akaVotes: 3, aoVotes: 2, akaScore: 21, aoScore: 20 },
      // B loses to A but crushes C.
      { groupId: "G1", akaId: "B", aoId: "C", winnerId: "B", akaVotes: 5, aoVotes: 0, akaScore: 30, aoScore: 18 },
    ];
    const ranked = rankGroupAthletes(group, results, "TOTAL_SCORE");
    // scoreFor: A=42, B=50, C=38 -> B first despite fewer wins.
    expect(ranked.map((r) => r.registrationId)).toEqual(["B", "A", "C"]);
  });
});

describe("advanceToElimination", () => {
  it("orders group winners before runners-up", () => {
    const simple = [
      [
        { registrationId: "g1w", rank: 1, wins: 0, victoryPoints: 0, votesFor: 0, scoreFor: 0 },
        { registrationId: "g1r", rank: 2, wins: 0, victoryPoints: 0, votesFor: 0, scoreFor: 0 },
      ],
      [
        { registrationId: "g2w", rank: 1, wins: 0, victoryPoints: 0, votesFor: 0, scoreFor: 0 },
        { registrationId: "g2r", rank: 2, wins: 0, victoryPoints: 0, votesFor: 0, scoreFor: 0 },
      ],
      [
        { registrationId: "g3w", rank: 1, wins: 0, victoryPoints: 0, votesFor: 0, scoreFor: 0 },
        { registrationId: "g3r", rank: 2, wins: 0, victoryPoints: 0, votesFor: 0, scoreFor: 0 },
      ],
    ];
    expect(advanceToElimination(simple, 2)).toEqual([
      "g1w",
      "g2w",
      "g3w",
      "g1r",
      "g2r",
      "g3r",
    ]);
    expect(advanceToElimination(simple, 1)).toEqual(["g1w", "g2w", "g3w"]);
  });
});

describe("buildKataStageGraph", () => {
  function buildFor(
    n: number,
    format: "ROUND_ROBIN" | "GROUPS_THEN_ELIMINATION"
  ) {
    const participants = mkParticipants(n);
    const groups = buildKataGroups(participants, {
      randomSeed: 5,
      categoryId: "cat-9",
    });
    const pairings = groups.flatMap(roundRobinBouts);
    const graph = buildKataStageGraph({
      categoryId: "cat-9",
      rulesetId: "WKF_KATA_2026",
      format,
      groups,
      pairings,
      advancePerGroup: 2,
      rankingMethod: "WKF_VICTORY_POINTS",
      randomSeed: 5,
    });
    return { groups, pairings, graph };
  }

  it("builds a pure round-robin graph: 8 athletes -> 2 groups x 6 bouts", () => {
    const { graph } = buildFor(8, "ROUND_ROBIN");
    expect(graph.format).toBe("ROUND_ROBIN");
    expect(graph.matches).toHaveLength(12);
    expect(graph.matches.every((m) => m.bracketType === "POOL")).toBe(true);
    expect(graph.matches.every((m) => m.poolId !== null)).toBe(true);
    expect(graph.pools).toHaveLength(2);
    expect(graph.pools[0]?.registrationIds).toHaveLength(4);
    expect(typeof graph.checksum).toBe("string");
    expect(graph.checksum.length).toBeGreaterThan(0);
  });

  it("builds elimination placeholders for GROUPS_THEN_ELIMINATION", () => {
    // 12 athletes -> 4 groups of 3 -> 3 bouts each = 12 group bouts.
    // 8 advancers -> bracket of 8 -> 7 elimination matches.
    const { graph } = buildFor(12, "GROUPS_THEN_ELIMINATION");
    expect(graph.format).toBe("POOLS_THEN_ELIM");
    const poolMatches = graph.matches.filter((m) => m.bracketType === "POOL");
    const elimMatches = graph.matches.filter((m) => m.bracketType === "MAIN");
    expect(poolMatches).toHaveLength(12);
    expect(elimMatches).toHaveLength(7);

    // Placeholder slots carry no athletes yet.
    const elimSlots = graph.slots.filter((s) =>
      elimMatches.some((m) => m.id === s.matchId)
    );
    expect(elimSlots.every((s) => s.registrationId === null)).toBe(true);

    // Standard round names for the elimination stage.
    expect(elimMatches.map((m) => m.roundName)).toEqual([
      "Quarter-final",
      "Quarter-final",
      "Quarter-final",
      "Quarter-final",
      "Semi-final",
      "Semi-final",
      "Final",
    ]);

    // Later rounds are wired by WINNER_OF.
    const laterSlots = elimSlots.filter((s) => s.slotType === "WINNER_OF");
    expect(laterSlots.length).toBeGreaterThan(0);
    expect(laterSlots.every((s) => s.sourceMatchId !== null)).toBe(true);
  });

  it("places structural byes by standard seeding when advancers do not fill the bracket", () => {
    // 9 athletes -> 3 groups of 3 -> 6 advancers -> bracket of 8 -> 2 byes.
    const { graph } = buildFor(9, "GROUPS_THEN_ELIMINATION");
    const byeSlots = graph.slots.filter((s) => s.slotType === "BYE");
    expect(byeSlots).toHaveLength(2);
    // kataFoughtBoutCount excludes the bye-involved matches:
    // 9 group bouts + 7 elimination matches - 2 bye matches = 14.
    expect(kataFoughtBoutCount(graph)).toBe(14);
  });

  it("refuses SINGLE_ELIM_REPECHAGE", () => {
    const participants = mkParticipants(4);
    const groups = buildKataGroups(participants, { randomSeed: 1 });
    expect(() =>
      buildKataStageGraph({
        categoryId: "cat-9",
        rulesetId: "WKF_KATA_2026",
        format: "SINGLE_ELIM_REPECHAGE",
        groups,
        pairings: groups.flatMap(roundRobinBouts),
        advancePerGroup: 2,
        rankingMethod: "WKF_VICTORY_POINTS",
        randomSeed: 1,
      })
    ).toThrow();
  });
});

describe("parse helpers", () => {
  it("defaults unknown kata formats to single elimination", () => {
    expect(parseKataDrawFormat(null)).toBe("SINGLE_ELIM_REPECHAGE");
    expect(parseKataDrawFormat("BOGUS")).toBe("SINGLE_ELIM_REPECHAGE");
    expect(parseKataDrawFormat("ROUND_ROBIN")).toBe("ROUND_ROBIN");
    expect(parseKataDrawFormat("GROUPS_THEN_ELIMINATION")).toBe(
      "GROUPS_THEN_ELIMINATION"
    );
  });

  it("defaults unknown ranking methods to WKF_VICTORY_POINTS", () => {
    expect(parseKataRankingMethod(null)).toBe("WKF_VICTORY_POINTS");
    expect(parseKataRankingMethod("TOTAL_SCORE")).toBe("TOTAL_SCORE");
  });
});
