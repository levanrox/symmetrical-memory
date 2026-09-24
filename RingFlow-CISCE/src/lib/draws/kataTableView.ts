import type {
  KataDrawFormat,
  KataRankingMethod,
  RankedKataAthlete,
} from "./kataDraws";

/**
 * The kata group-stage draw as tables — the "scoring sheet" view.
 *
 * Pure module: `assembleCategoryDraw` feeds it the snapshot, the resolved
 * athlete names, the pool bouts and the per-side score sums, and this builds
 * the per-group tables (one table per group, every participant named) plus
 * the metadata the finals table needs. Standings (points / total / rank)
 * come from the official `kata_group_standings` rows when they exist —
 * the same record the elimination fill-in uses — and fall back to the
 * snapshot order with zeroes before any bout is confirmed.
 */

export interface KataTableBout {
  matchId: string;
  matchNo: number;
  /** e.g. "Group A · Round 2". */
  roundLabel: string;
  opponentId: string | null;
  opponentName: string;
  /** This fighter's summed judge marks (1 decimal), null when unscored. */
  score: number | null;
  opponentScore: number | null;
  /** null while the bout is undecided. */
  won: boolean | null;
  status: string;
}

export interface KataTableMember {
  id: string;
  name: string;
  school?: string;
  chestNumber?: string | null;
  bouts: KataTableBout[];
  wins: number;
  /** WKF victory points (3 per win). */
  points: number;
  /** Official total score sum across the member's group bouts. */
  totalScore: number;
  rank: number;
  /** True when the member currently holds an elimination slot. */
  qualified: boolean;
}

export interface KataTableGroup {
  id: string;
  name: string;
  members: KataTableMember[];
}

export interface KataDrawTableView {
  format: Extract<KataDrawFormat, "GROUPS_THEN_ELIMINATION" | "ROUND_ROBIN">;
  rankingMethod: KataRankingMethod;
  advancePerGroup: number;
  groups: KataTableGroup[];
  /**
   * Summed judge marks per bout per side (tenths -> units), for every match
   * in the category — pool bouts drive the group tables, the rest drives the
   * finals table. Null when that side has no recorded marks yet.
   */
  scoresByMatch: Record<string, { aka: number | null; ao: number | null }>;
}

export interface KataTableAthlete {
  id: string;
  name: string;
  school?: string;
  chestNumber?: string | null;
}

/** The snapshot shape this view accepts: group formats only. */
interface GroupFormatSnapshot {
  format: KataDrawTableView["format"];
  rankingMethod: KataRankingMethod;
  advancePerGroup: number;
  groups: { id: string; name: string; memberIds: string[] }[];
}

export interface KataTablePoolBout {
  matchId: string;
  matchNo: number;
  roundLabel: string;
  groupId: string;
  akaId: string | null;
  aoId: string | null;
  /** Summed judge marks per side, null when that side is unscored. */
  akaScore: number | null;
  aoScore: number | null;
  winnerId: string | null;
  status: string;
}

function isGroupFormat(format: string): format is KataDrawTableView["format"] {
  return format === "GROUPS_THEN_ELIMINATION" || format === "ROUND_ROBIN";
}

function isSnapshot(value: unknown): value is GroupFormatSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.format === "string" &&
    isGroupFormat(s.format) &&
    Array.isArray(s.groups) &&
    s.groups.every(
      (g) =>
        g &&
        typeof g === "object" &&
        typeof (g as { id?: unknown }).id === "string" &&
        typeof (g as { name?: unknown }).name === "string" &&
        Array.isArray((g as { memberIds?: unknown }).memberIds)
    )
  );
}

/**
 * Build the table view for a kata group-format draw.
 *
 * - `athletes`: every athlete that can appear, keyed by id.
 * - `poolBouts`: the group's round-robin bouts with per-side score sums.
 * - `standingsByGroup`: official `kata_group_standings` rows keyed by group
 *   id; missing groups fall back to snapshot order with zeroed tallies.
 *
 * Returns null when there is no usable group snapshot (single elimination,
 * legacy draws), so callers can fall back to the tree view.
 */
export function buildKataDrawTableView(args: {
  snapshot: unknown;
  athletes: ReadonlyMap<string, KataTableAthlete>;
  poolBouts: readonly KataTablePoolBout[];
  standingsByGroup: ReadonlyMap<string, readonly RankedKataAthlete[]>;
  scoresByMatch?: Record<string, { aka: number | null; ao: number | null }>;
}): KataDrawTableView | null {
  const { snapshot, athletes, poolBouts, standingsByGroup, scoresByMatch } = args;
  if (!isSnapshot(snapshot)) return null;

  const groups: KataTableGroup[] = snapshot.groups.map((group) => {
    const boutsForGroup = poolBouts
      .filter((b) => b.groupId === group.id)
      .sort((a, b) => a.matchNo - b.matchNo);

    const standings = new Map(
      (standingsByGroup.get(group.id) ?? []).map((s) => [s.registrationId, s])
    );

    const members: KataTableMember[] = group.memberIds.map((memberId, index) => {
      const athlete = athletes.get(memberId);
      const standing = standings.get(memberId);

      const bouts: KataTableBout[] = boutsForGroup
        .filter((b) => b.akaId === memberId || b.aoId === memberId)
        .map((b) => {
          const isAka = b.akaId === memberId;
          const opponentId = isAka ? b.aoId : b.akaId;
          const opponent = opponentId ? athletes.get(opponentId) : undefined;
          return {
            matchId: b.matchId,
            matchNo: b.matchNo,
            roundLabel: b.roundLabel,
            opponentId,
            opponentName: opponent?.name ?? "TBD",
            score: isAka ? b.akaScore : b.aoScore,
            opponentScore: isAka ? b.aoScore : b.akaScore,
            won: b.winnerId == null ? null : b.winnerId === memberId,
            status: b.status,
          };
        });

      const rank = standing?.rank ?? index + 1;
      return {
        id: memberId,
        name: athlete?.name ?? "Unknown athlete",
        school: athlete?.school,
        chestNumber: athlete?.chestNumber ?? null,
        bouts,
        wins: standing?.wins ?? 0,
        points: standing?.victoryPoints ?? 0,
        totalScore: standing?.scoreFor ?? 0,
        rank,
        qualified:
          snapshot.format === "GROUPS_THEN_ELIMINATION" &&
          rank <= snapshot.advancePerGroup,
      };
    });

    // Official order first; members missing from the standings keep
    // snapshot order at the bottom.
    members.sort((a, b) => a.rank - b.rank);

    return { id: group.id, name: group.name, members };
  });

  return {
    format: snapshot.format,
    rankingMethod: snapshot.rankingMethod,
    advancePerGroup: snapshot.advancePerGroup,
    groups,
    scoresByMatch: scoresByMatch ?? {},
  };
}
