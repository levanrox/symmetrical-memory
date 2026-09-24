import { db } from "@/db";
import {
  athletes,
  categories,
  draws,
  drawVersions,
  kataGroupStandings,
  kataScores,
  matches,
  matchSlots,
} from "@/db/schema";
import { resolveDraw } from "@/engine/draw-engine/resolution";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { eq, inArray, sql } from "drizzle-orm";
import {
  buildKataDrawTableView,
  type KataDrawTableView,
  type KataTablePoolBout,
} from "./kataTableView";
import type { RankedKataAthlete } from "./kataDraws";

/**
 * One category's draw, assembled for display: every bout with its slots, the
 * recorded points, the resolved status and the winner, plus the podium.
 *
 * Deliberately request-free: the staff/public gate lives in the action that
 * calls this, so scripts and the results export can read a bracket without a
 * browser session.
 */
export interface BracketSlotView {
  position: number;
  registrationId: string | null;
  sourceMatchId: string | null;
}

export interface BracketMatchView {
  matchId: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: string;
  status: string;
  slots?: BracketSlotView[];
  aka: { displayName: string; school?: string; id?: string; chestNumber?: string | null };
  ao: { displayName: string; school?: string; id?: string; chestNumber?: string | null };
  winnerId?: string | null;
  /** The recorded result of the bout, so the draw can show the score line. */
  akaScore?: number;
  aoScore?: number;
  akaPenalties?: number;
  aoPenalties?: number;
  senshu?: string | null;
  winnerSide?: string | null;
  decisionMethod?: string | null;
  state?: {
    points?: { aka: number; ao: number };
    winner?: { side: string; method: string };
  } | null;
}

export async function assembleCategoryDraw(
  categoryId: string,
  options?: { athleteId?: string | null }
) {
  const [category] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId));

  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  if (!draw) return null;

  const [latestVersion] = await db
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);

  if (!latestVersion) return null;

  const graph = latestVersion.graph as unknown as DrawGraph;

  // Fetch all db matches, slots, and events to resolve current state
  const dbMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.categoryId, categoryId));

  const dbSlots = await db
    .select()
    .from(matchSlots)
    .where(
      inArray(
        matchSlots.matchId,
        dbMatches.map((m) => m.id)
      )
    );

  // Fetch all athletes in this tournament for name mapping
  const athleteList = await db.select().from(athletes);
  const athleteMap = new Map(athleteList.map((a) => [a.id, a]));

  // Map outcomes if matches were completed
  const outcomes = new Map<string, { kind: 'WINNER'; side: 'AKA' | 'AO' }>();
  for (const m of dbMatches) {
    if (m.winnerId) {
      let side: 'AKA' | 'AO' = (m.winnerSide as 'AKA' | 'AO') || 'AKA';
      if (!m.winnerSide) {
        const matchSlotsList = dbSlots.filter((s) => s.matchId === m.id);
        const aka = matchSlotsList.find((s) => s.position === 1);
        side = m.winnerId === aka?.athleteId ? 'AKA' : 'AO';
      }
      outcomes.set(m.id, {
        kind: 'WINNER',
        side,
      });
    }
  }

  const resolved = resolveDraw(graph, outcomes);
  const resolvedMatchMap = new Map(resolved.matches.map((rm) => [rm.matchId, rm]));
  // The recorded rows carry the scores the draw sheet should display.
  const matchRowById = new Map(dbMatches.map((row) => [row.id, row]));

  // Build client-ready BracketMatch array
  const matchesMap: Record<string, BracketMatchView> = {};
  /** Graph pool id per match, so the kata table view can group pool bouts. */
  const poolIdByMatch = new Map<string, string | null>();

  for (const m of graph.matches) {
    poolIdByMatch.set(m.id, m.poolId ?? null);
    const resolvedMatch = resolvedMatchMap.get(m.id);
    const slotsForMatch = dbSlots
      .filter((s) => s.matchId === m.id)
      .map((s) => ({
        position: s.position,
        registrationId: s.athleteId,
        sourceMatchId: s.sourceMatchId,
      }));

    const akaRegId = resolvedMatch?.slots[0]?.registrationId;
    const aoRegId = resolvedMatch?.slots[1]?.registrationId;

    const akaAthlete = akaRegId ? athleteMap.get(akaRegId) : null;
    const aoAthlete = aoRegId ? athleteMap.get(aoRegId) : null;

    const recorded = matchRowById.get(m.id);

    matchesMap[m.id] = {
      matchId: m.id,
      matchNo: m.matchNo,
      roundNo: m.roundNo,
      roundName: m.roundName,
      bracketType: m.bracketType,
      status: resolvedMatch?.status ?? "SCHEDULED",
      slots: slotsForMatch,
      aka: {
        id: akaAthlete?.id,
        displayName: akaAthlete?.name ?? "TBD",
        school: akaAthlete?.school || akaAthlete?.dojo || undefined,
        chestNumber: akaAthlete?.chestNumber ?? null,
      },
      ao: {
        id: aoAthlete?.id,
        displayName: aoAthlete?.name ?? "TBD",
        school: aoAthlete?.school || aoAthlete?.dojo || undefined,
        chestNumber: aoAthlete?.chestNumber ?? null,
      },
      akaScore: recorded?.akaScore ?? 0,
      aoScore: recorded?.aoScore ?? 0,
      akaPenalties: recorded?.akaPenalties ?? 0,
      aoPenalties: recorded?.aoPenalties ?? 0,
      senshu: recorded?.senshu ?? null,
      winnerSide: recorded?.winnerSide ?? null,
      decisionMethod: recorded?.decisionMethod ?? null,
      winnerId: resolvedMatch?.winnerRegistrationId ?? null,
      state: resolvedMatch?.winnerRegistrationId
        ? {
            points: { aka: recorded?.akaScore ?? 0, ao: recorded?.aoScore ?? 0 },
            winner: {
              side: resolvedMatch.winnerRegistrationId === akaRegId ? 'AKA' : 'AO',
              method: recorded?.decisionMethod || 'CONFIRMED',
            },
          }
        : null,
    };
  }

  return {
    locked: false,
    draw,
    categoryName: category?.name ?? graph.categoryId,
    /** How this bracket was built: 0, 1 or 2 bronze medals. */
    bronzeMedals: draw.bronzeMedals ?? 2,
    matches: Object.values(matchesMap),
    podium: resolved.podium,
    highlightAthleteId: options?.athleteId ?? null,
    /**
     * Kata group formats render as tables (one per group, every participant
     * named), not as a tree — the "scoring sheet" view. Null for elimination
     * draws and legacy draws without a group snapshot.
     */
    kataDraw: await buildKataDrawView({
      categoryId,
      snapshot: draw.kataGroups,
      athleteMap,
      poolIdByMatch,
      matchesMap,
    }),
  };
}

/**
 * Resolve the kata group-stage table view for a draw, or null when the draw
 * is not a group format. Scores come from `kata_scores` (summed judge marks,
 * tenths -> units — the same sums the decision totals use); standings come
 * from the official `kata_group_standings` rows the confirm flow maintains.
 */
async function buildKataDrawView(args: {
  categoryId: string;
  snapshot: unknown;
  athleteMap: Map<string, { id: string; name: string; school: string | null; dojo: string | null; chestNumber: string | null }>;
  poolIdByMatch: Map<string, string | null>;
  matchesMap: Record<string, BracketMatchView>;
}): Promise<KataDrawTableView | null> {
  const { categoryId, snapshot, athleteMap, poolIdByMatch, matchesMap } = args;
  if (!snapshot || typeof snapshot !== "object") return null;
  const format = (snapshot as { format?: unknown }).format;
  if (format !== "GROUPS_THEN_ELIMINATION" && format !== "ROUND_ROBIN") {
    return null;
  }

  const matchIds = Object.keys(matchesMap);
  const [scoreRows, standingRows] = await Promise.all([
    matchIds.length > 0
      ? db
          .select({
            matchId: kataScores.matchId,
            side: kataScores.side,
            scoreTenths: kataScores.scoreTenths,
          })
          .from(kataScores)
          .where(inArray(kataScores.matchId, matchIds))
      : Promise.resolve([]),
    db
      .select({
        groupId: kataGroupStandings.groupId,
        standings: kataGroupStandings.standings,
      })
      .from(kataGroupStandings)
      .where(eq(kataGroupStandings.categoryId, categoryId)),
  ]);

  // Summed judge marks per bout per side (tenths -> units).
  const sums = new Map<string, { total: number; count: number }>();
  for (const row of scoreRows) {
    const key = `${row.matchId}:${row.side}`;
    const entry = sums.get(key) ?? { total: 0, count: 0 };
    entry.total += row.scoreTenths / 10;
    entry.count += 1;
    sums.set(key, entry);
  }
  const sideScore = (matchId: string, side: "AKA" | "AO"): number | null => {
    const entry = sums.get(`${matchId}:${side}`);
    if (!entry || entry.count === 0) return null;
    return Math.round(entry.total * 10) / 10;
  };

  const scoresByMatch: Record<string, { aka: number | null; ao: number | null }> = {};
  for (const matchId of matchIds) {
    scoresByMatch[matchId] = { aka: sideScore(matchId, "AKA"), ao: sideScore(matchId, "AO") };
  }

  const poolBouts: KataTablePoolBout[] = [];
  for (const [matchId, view] of Object.entries(matchesMap)) {
    const groupId = poolIdByMatch.get(matchId);
    if (!groupId) continue;
    poolBouts.push({
      matchId,
      matchNo: view.matchNo,
      roundLabel: view.roundName,
      groupId,
      akaId: view.aka.id ?? null,
      aoId: view.ao.id ?? null,
      akaScore: sideScore(matchId, "AKA"),
      aoScore: sideScore(matchId, "AO"),
      winnerId: view.winnerId ?? null,
      status: view.status,
    });
  }

  const standingsByGroup = new Map<string, readonly RankedKataAthlete[]>();
  for (const row of standingRows) {
    const list = row.standings as readonly RankedKataAthlete[] | null;
    if (Array.isArray(list)) standingsByGroup.set(row.groupId, list);
  }

  const athletes = new Map(
    [...athleteMap.values()].map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        school: a.school || a.dojo || undefined,
        chestNumber: a.chestNumber ?? null,
      },
    ])
  );

  return buildKataDrawTableView({
    snapshot,
    athletes,
    poolBouts,
    standingsByGroup,
    scoresByMatch,
  });
}
