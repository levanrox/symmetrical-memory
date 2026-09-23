import { checksumOf } from "@/engine/draw-engine/canonical";
import { createRng, shuffle } from "@/engine/draw-engine/seeding";
import {
  matchIdFor,
  mustGet,
  nextPowerOfTwo,
  roundName,
  seedPositions,
  slotIdFor,
  totalRounds,
} from "@/engine/draw-engine/sizing";
import type {
  DrawGraph,
  MatchNode,
  Participant,
  Pool,
  Round,
  SlotNode,
} from "@/engine/draw-engine/types";

/**
 * Kata draw formats (P2).
 *
 * Per-category configuration, stored on `categories.kata_format`. The single
 * elimination default keeps going through the draw engine untouched; the two
 * group formats are built here.
 *
 * `GROUPS_THEN_ELIMINATION` is the organiser-facing name for what the
 * rules-engine calls `POOLS_THEN_ELIM`; the graph stored in `draw_versions`
 * uses the engine vocabulary so `resolveDraw`/`assembleCategoryDraw` keep
 * working.
 */
export const KATA_DRAW_FORMATS = [
  "SINGLE_ELIM_REPECHAGE",
  "GROUPS_THEN_ELIMINATION",
  "ROUND_ROBIN",
] as const;
export type KataDrawFormat = (typeof KATA_DRAW_FORMATS)[number];

/** Ranking methods for a kata group, stored on `categories.kata_ranking_method`. */
export const KATA_RANKING_METHODS = ["WKF_VICTORY_POINTS", "TOTAL_SCORE"] as const;
export type KataRankingMethod = (typeof KATA_RANKING_METHODS)[number];

export const DEFAULT_KATA_FORMAT: KataDrawFormat = "SINGLE_ELIM_REPECHAGE";
export const DEFAULT_KATA_ADVANCE_PER_GROUP = 2;
export const DEFAULT_KATA_RANKING_METHOD: KataRankingMethod = "WKF_VICTORY_POINTS";

/** A draw entrant with its optional organiser-assigned seed (1 = strongest). */
export interface KataParticipant extends Participant {
  seed: number | null;
}

export interface KataGroup {
  /** Stable within the category, e.g. `${categoryId}:G1`. Also stored on `matches.group_id`. */
  id: string;
  /** Human label, e.g. "Group A". */
  name: string;
  members: KataParticipant[];
}

export interface KataDrawBuildOptions {
  /** Target athletes per group; overrides the WKF 3.7.9 table when set. */
  groupSizeOverride?: number | null;
  /** Seeded RNG input so a redraw is reproducible; defaults to Date.now(). */
  randomSeed?: number;
  /** Namespaces group ids; pass the category id in production. */
  categoryId?: string;
}

/**
 * WKF kata rules 3.7.9: how many groups a field of athletes is split into.
 *
 * 24-32 -> 8 groups, 17-23 -> 6, 12-16 -> 4, 9-11 -> 3, 6-8 -> 2, 3-5 -> 1.
 * Fewer than 3 athletes still yields a single group (a two-athlete category is
 * one bout either way).
 */
export function wkfGroupCount(athleteCount: number): number {
  if (athleteCount >= 24) return 8;
  if (athleteCount >= 17) return 6;
  if (athleteCount >= 12) return 4;
  if (athleteCount >= 9) return 3;
  if (athleteCount >= 6) return 2;
  return 1;
}

/** Resolves the group count, honouring an explicit athletes-per-group override. */
export function resolveGroupCount(
  athleteCount: number,
  groupSizeOverride?: number | null
): number {
  let count: number;
  if (groupSizeOverride != null && groupSizeOverride > 0) {
    count = Math.ceil(athleteCount / groupSizeOverride);
  } else {
    count = wkfGroupCount(athleteCount);
  }
  return Math.min(Math.max(1, count), Math.max(1, athleteCount));
}

function groupLabel(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  return `G${index + 1}`;
}

/**
 * Splits participants into groups.
 *
 * The top-4 ranked athletes (lowest seed numbers) are distributed one per
 * group in seed order, so they cannot meet before the elimination stage. Every
 * remaining athlete — including seeds 5 and up — is drawn randomly (via the
 * seeded RNG) and dealt round-robin across the groups, which keeps group sizes
 * balanced to within one athlete.
 *
 * Pure: randomness comes only from `options.randomSeed`.
 */
export function buildKataGroups(
  participants: readonly KataParticipant[],
  options: KataDrawBuildOptions = {}
): KataGroup[] {
  const count = participants.length;
  if (count === 0) {
    throw new Error("buildKataGroups needs at least one participant");
  }

  const groupCount = resolveGroupCount(count, options.groupSizeOverride);
  const groups: KataGroup[] = Array.from({ length: groupCount }, (_, i) => ({
    id: options.categoryId ? `${options.categoryId}:G${i + 1}` : `G${i + 1}`,
    name: `Group ${groupLabel(i)}`,
    members: [],
  }));

  const ranked = [...participants]
    .filter((p) => p.seed != null)
    .sort((a, b) => (a.seed as number) - (b.seed as number))
    .slice(0, 4);
  const rankedIds = new Set(ranked.map((p) => p.registrationId));
  ranked.forEach((p, i) => {
    mustGet(groups, i % groupCount, "kata group").members.push(p);
  });

  const rng = createRng(options.randomSeed ?? Date.now());
  const rest = shuffle(
    participants.filter((p) => !rankedIds.has(p.registrationId)),
    rng
  );
  rest.forEach((p, i) => {
    mustGet(groups, i % groupCount, "kata group").members.push(p);
  });

  return groups;
}

/** One group-stage bout pairing: who fights whom, in which circle round. */
export interface KataBoutPairing {
  groupId: string;
  /** 0-based circle-method round within the group. */
  round: number;
  akaId: string;
  aoId: string;
}

/**
 * Round-robin pairings via the circle method: every athlete meets every other
 * athlete exactly once. An odd-sized group gets a bye rotation (one athlete
 * sits out each round). AKA/AO sides are assigned by greedy balancing — the
 * athlete with fewer AKA bouts so far takes AKA — so nobody is stuck on one
 * side all day (a group of 8 lands at 3-4 AKA bouts each out of 7).
 *
 * A group of n produces n*(n-1)/2 bouts (n=8 -> 28).
 */
export function roundRobinBouts(group: KataGroup): KataBoutPairing[] {
  const ids = group.members.map((m) => m.registrationId);
  const n = ids.length;
  if (n < 2) return [];

  const working: (string | null)[] = [...ids];
  if (n % 2 === 1) working.push(null); // bye rotation slot
  const size = working.length;
  const pairings: KataBoutPairing[] = [];
  const akaCount = new Map<string, number>();

  for (let r = 0; r < size - 1; r += 1) {
    for (let i = 0; i < size / 2; i += 1) {
      const a = mustGet(working, i, "circle list");
      const b = mustGet(working, size - 1 - i, "circle list");
      if (a === null || b === null) continue;
      const countA = akaCount.get(a) ?? 0;
      const countB = akaCount.get(b) ?? 0;
      const akaFirst =
        countA < countB ? true : countB < countA ? false : (r + i) % 2 === 0;
      const akaId = akaFirst ? a : b;
      akaCount.set(akaId, (akaCount.get(akaId) ?? 0) + 1);
      pairings.push({
        groupId: group.id,
        round: r,
        akaId,
        aoId: akaFirst ? b : a,
      });
    }
    // Rotate: keep the first athlete fixed, move the last one to position 1.
    const moved = working.splice(size - 1, 1);
    working.splice(1, 0, mustGet(moved, 0, "rotated athlete"));
  }

  return pairings;
}

/** One completed group-stage bout, as recorded by scoring. */
export interface KataGroupBoutResult {
  groupId: string;
  akaId: string;
  aoId: string;
  /** Individual kata bouts always produce a winner — no draws. */
  winnerId: string;
  /** Judges' votes for each side. */
  akaVotes: number;
  aoVotes: number;
  /** Total score sums for each side. */
  akaScore: number;
  aoScore: number;
}

export interface RankedKataAthlete {
  registrationId: string;
  rank: number;
  wins: number;
  victoryPoints: number;
  votesFor: number;
  scoreFor: number;
}

interface KataTally {
  registrationId: string;
  wins: number;
  victoryPoints: number;
  votesFor: number;
  scoreFor: number;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function headToHeadWinner(
  a: string,
  b: string,
  boutOf: ReadonlyMap<string, KataGroupBoutResult>
): string | null {
  const bout = boutOf.get(pairKey(a, b));
  return bout ? bout.winnerId : null;
}

function compareKataAthletes(
  a: KataTally,
  b: KataTally,
  method: KataRankingMethod,
  boutOf: ReadonlyMap<string, KataGroupBoutResult>
): number {
  if (method === "WKF_VICTORY_POINTS") {
    // Tie ladder: victory points -> head-to-head -> judges' votes -> score sum.
    if (a.victoryPoints !== b.victoryPoints) return b.victoryPoints - a.victoryPoints;
    const h2h = headToHeadWinner(a.registrationId, b.registrationId, boutOf);
    if (h2h === a.registrationId) return -1;
    if (h2h === b.registrationId) return 1;
    if (a.votesFor !== b.votesFor) return b.votesFor - a.votesFor;
    if (a.scoreFor !== b.scoreFor) return b.scoreFor - a.scoreFor;
  } else {
    // TOTAL_SCORE (local style): score sum -> judges' votes -> victory points -> head-to-head.
    if (a.scoreFor !== b.scoreFor) return b.scoreFor - a.scoreFor;
    if (a.votesFor !== b.votesFor) return b.votesFor - a.votesFor;
    if (a.victoryPoints !== b.victoryPoints) return b.victoryPoints - a.victoryPoints;
    const h2h = headToHeadWinner(a.registrationId, b.registrationId, boutOf);
    if (h2h === a.registrationId) return -1;
    if (h2h === b.registrationId) return 1;
  }
  // Fully tied: deterministic by id so the ranking is always total.
  return a.registrationId < b.registrationId
    ? -1
    : a.registrationId > b.registrationId
      ? 1
      : 0;
}

/**
 * Ranks one group's athletes from its completed bouts.
 *
 * `WKF_VICTORY_POINTS`: 3 points per bout win; ties break on victory points,
 * then the head-to-head result, then total judges' votes, then total score sum.
 * `TOTAL_SCORE`: highest total score across the athlete's group bouts wins;
 * ties break on judges' votes, then victory points, then head-to-head.
 *
 * Bouts that reference athletes outside the group, or name a winner who did not
 * fight the bout, are ignored rather than corrupting the table.
 */
export function rankGroupAthletes(
  group: KataGroup,
  results: readonly KataGroupBoutResult[],
  method: KataRankingMethod
): RankedKataAthlete[] {
  const tallies = new Map<string, KataTally>();
  for (const m of group.members) {
    tallies.set(m.registrationId, {
      registrationId: m.registrationId,
      wins: 0,
      victoryPoints: 0,
      votesFor: 0,
      scoreFor: 0,
    });
  }

  const boutOf = new Map<string, KataGroupBoutResult>();
  for (const r of results) {
    if (r.groupId !== group.id) continue;
    const aka = tallies.get(r.akaId);
    const ao = tallies.get(r.aoId);
    const winner = tallies.get(r.winnerId);
    if (!aka || !ao || !winner) continue;
    if (r.winnerId !== r.akaId && r.winnerId !== r.aoId) continue;
    winner.wins += 1;
    winner.victoryPoints += 3;
    aka.votesFor += r.akaVotes;
    ao.votesFor += r.aoVotes;
    aka.scoreFor += r.akaScore;
    ao.scoreFor += r.aoScore;
    boutOf.set(pairKey(r.akaId, r.aoId), r);
  }

  const sorted = [...tallies.values()].sort((a, b) =>
    compareKataAthletes(a, b, method, boutOf)
  );
  return sorted.map((t, i) => ({ ...t, rank: i + 1 }));
}

/**
 * Orders the advancers for elimination-bracket seeding.
 *
 * Group winners come first (G1 winner, G2 winner, ...), then all runners-up,
 * and so on. Feeding this order into standard `seedPositions` pairs the
 * strongest advancers against the weakest for as long as possible.
 */
export function advanceToElimination(
  rankedGroups: readonly RankedKataAthlete[][],
  advancePerGroup: number
): string[] {
  const advancers: string[] = [];
  for (let place = 0; place < advancePerGroup; place += 1) {
    for (const group of rankedGroups) {
      const athlete = group[place];
      if (athlete) advancers.push(athlete.registrationId);
    }
  }
  return advancers;
}

export interface KataStageGraphInput {
  categoryId: string;
  rulesetId: string;
  /** Organiser vocabulary; SINGLE_ELIM_REPECHAGE is refused (use generateDraw). */
  format: KataDrawFormat;
  groups: KataGroup[];
  pairings: readonly KataBoutPairing[];
  advancePerGroup: number;
  rankingMethod: KataRankingMethod;
  randomSeed: number;
}

/**
 * Builds the storable draw graph for a kata group stage.
 *
 * Group bouts are `bracketType: "POOL"` matches carrying `poolId` (mirrored to
 * `matches.group_id` at write time). For GROUPS_THEN_ELIMINATION the
 * elimination bracket is generated immediately as **placeholder** matches: the
 * advancers are unknown until the group stage is scored, so first-round slots
 * are empty `ATHLETE` slots (TBD, filled by the follow-up phase in
 * `advanceToElimination` order) and seeds past the advancer count are
 * structural `BYE`s, exactly where standard seeding puts them. Later rounds
 * are wired with `WINNER_OF`, so advancement is a graph walk once the
 * placeholders are filled.
 *
 * The placeholder choice keeps one draw version, one `lockedAt` flow and one
 * match list for the ring queue and progress bars, instead of a second
 * generation step mid-event.
 */
export function buildKataStageGraph(input: KataStageGraphInput): DrawGraph {
  if (input.format === "SINGLE_ELIM_REPECHAGE") {
    throw new Error(
      "buildKataStageGraph is only for group formats; use generateDraw for single elimination"
    );
  }

  const { categoryId, groups } = input;
  const matches: MatchNode[] = [];
  const slots: SlotNode[] = [];
  const rounds: Round[] = [];
  let matchNo = 1;
  let roundNo = 0;

  const addMatch = (
    roundNameText: string,
    bracketType: MatchNode["bracketType"],
    poolId: string | null,
    fillers: [SlotNode, SlotNode]
  ): string => {
    const matchId = matchIdFor(categoryId, matchNo);
    matches.push({
      id: matchId,
      matchNo,
      roundNo,
      roundName: roundNameText,
      bracketType,
      poolId,
      slotIds: [slotIdFor(matchId, 1), slotIdFor(matchId, 2)],
    });
    for (const filler of fillers) {
      slots.push({ ...filler, id: slotIdFor(matchId, filler.position), matchId });
    }
    matchNo += 1;
    return matchId;
  };

  // Group stage, group by group and circle round by circle round.
  for (const group of groups) {
    const groupPairings = input.pairings.filter((p) => p.groupId === group.id);
    const maxRound = groupPairings.reduce((m, p) => Math.max(m, p.round), -1);
    for (let r = 0; r <= maxRound; r += 1) {
      const roundNameText = `${group.name} · Round ${r + 1}`;
      const matchIds: string[] = [];
      for (const pairing of groupPairings.filter((p) => p.round === r)) {
        matchIds.push(
          addMatch(roundNameText, "POOL", group.id, [
            {
              id: "",
              matchId: "",
              position: 1,
              slotType: "ATHLETE",
              registrationId: pairing.akaId,
              sourceMatchId: null,
              repechageRule: null,
            },
            {
              id: "",
              matchId: "",
              position: 2,
              slotType: "ATHLETE",
              registrationId: pairing.aoId,
              sourceMatchId: null,
              repechageRule: null,
            },
          ])
        );
      }
      rounds.push({ roundNo, name: roundNameText, matchIds });
      roundNo += 1;
    }
  }

  // Elimination placeholders.
  if (input.format === "GROUPS_THEN_ELIMINATION") {
    const perGroup = Math.min(
      input.advancePerGroup,
      ...groups.map((g) => g.members.length)
    );
    const advancerCount = groups.length * perGroup;
    const size = Math.max(2, nextPowerOfTwo(advancerCount));
    const positions = seedPositions(size);

    const firstRoundMatchCount = size / 2;
    let previous: string[] = [];
    for (let index = 0; index < firstRoundMatchCount; index += 1) {
      const fillers = [1, 2].map((position) => {
        const seedNumber = mustGet(
          positions,
          index * 2 + (position - 1),
          "seed position"
        );
        return {
          id: "",
          matchId: "",
          position: position as 1 | 2,
          // A seed past the advancer count is a structural bye, placed by
          // standard seeding onto the strongest advancer slots.
          slotType: (seedNumber <= advancerCount ? "ATHLETE" : "BYE") as SlotNode["slotType"],
          registrationId: null,
          sourceMatchId: null,
          repechageRule: null,
        };
      }) as [SlotNode, SlotNode];
      previous.push(
        addMatch(roundName(firstRoundMatchCount), "MAIN", null, fillers)
      );
    }
    rounds.push({
      roundNo,
      name: roundName(firstRoundMatchCount),
      matchIds: [...previous],
    });
    roundNo += 1;

    for (let r = 1; r < totalRounds(size); r += 1) {
      const matchCount = previous.length / 2;
      const current: string[] = [];
      for (let index = 0; index < matchCount; index += 1) {
        current.push(
          addMatch(roundName(matchCount), "MAIN", null, [
            {
              id: "",
              matchId: "",
              position: 1,
              slotType: "WINNER_OF",
              registrationId: null,
              sourceMatchId: mustGet(previous, index * 2, "previous match"),
              repechageRule: null,
            },
            {
              id: "",
              matchId: "",
              position: 2,
              slotType: "WINNER_OF",
              registrationId: null,
              sourceMatchId: mustGet(previous, index * 2 + 1, "previous match"),
              repechageRule: null,
            },
          ])
        );
      }
      rounds.push({ roundNo, name: roundName(matchCount), matchIds: [...current] });
      roundNo += 1;
      previous = current;
    }
  }

  const pools: Pool[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    matchIds: matches.filter((m) => m.poolId === g.id).map((m) => m.id),
    registrationIds: g.members.map((m) => m.registrationId),
  }));

  const body: Omit<DrawGraph, "checksum"> = {
    categoryId,
    // Engine vocabulary: what the rules-engine calls POOLS_THEN_ELIM.
    format: input.format === "GROUPS_THEN_ELIMINATION" ? "POOLS_THEN_ELIM" : "ROUND_ROBIN",
    rulesetId: input.rulesetId,
    tournamentSize: groups.reduce((n, g) => n + g.members.length, 0),
    byeCount: 0,
    randomSeed: input.randomSeed,
    rounds,
    matches,
    slots,
    pools,
    warnings: [],
  };

  return { ...body, checksum: checksumOf(body) };
}

/**
 * How many bouts a kata group draw actually asks anyone to fight.
 *
 * Group bouts and placeholder elimination bouts (both slots ATHLETE, even with
 * TBD athletes) are real contests; matches touching a structural BYE slot are
 * walkovers. Written to `categories.expected_matches` like `foughtBoutCount`
 * is for the elimination path.
 */
export function kataFoughtBoutCount(graph: DrawGraph): number {
  const byeMatchIds = new Set<string>();
  for (const slot of graph.slots) {
    if (slot.slotType === "BYE") byeMatchIds.add(slot.matchId);
  }
  return graph.matches.filter((m) => !byeMatchIds.has(m.id)).length;
}

/** Snapshot stored on `draws.kata_groups` for the bracket fill-in phase. */
export interface KataGroupsSnapshot {
  format: KataDrawFormat;
  rankingMethod: KataRankingMethod;
  advancePerGroup: number;
  randomSeed: number;
  groups: { id: string; name: string; memberIds: string[] }[];
}

export function buildKataGroupsSnapshot(args: {
  format: KataDrawFormat;
  rankingMethod: KataRankingMethod;
  advancePerGroup: number;
  randomSeed: number;
  groups: KataGroup[];
}): KataGroupsSnapshot {
  return {
    format: args.format,
    rankingMethod: args.rankingMethod,
    advancePerGroup: args.advancePerGroup,
    randomSeed: args.randomSeed,
    groups: args.groups.map((g) => ({
      id: g.id,
      name: g.name,
      memberIds: g.members.map((m) => m.registrationId),
    })),
  };
}

/** Lenient parsing of the nullable `categories.kata_format` column. */
export function parseKataDrawFormat(value: unknown): KataDrawFormat {
  return (KATA_DRAW_FORMATS as readonly string[]).includes(value as string)
    ? (value as KataDrawFormat)
    : DEFAULT_KATA_FORMAT;
}

/** Lenient parsing of the nullable `categories.kata_ranking_method` column. */
export function parseKataRankingMethod(value: unknown): KataRankingMethod {
  return (KATA_RANKING_METHODS as readonly string[]).includes(value as string)
    ? (value as KataRankingMethod)
    : DEFAULT_KATA_RANKING_METHOD;
}
