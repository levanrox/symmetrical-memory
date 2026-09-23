/**
 * Kata group-stage follow-up (P3) — DB orchestration.
 *
 * Called from `confirmKataResult` (src/actions/judge.ts) after a group bout
 * is confirmed:
 *  1. recompute the group's standings from all its confirmed bouts
 *     (P2's `rankGroupAthletes`) and persist them to `kata_group_standings`;
 *  2. when EVERY group bout in the category is CONFIRMED, fill the TBD
 *     first-round elimination slots in bracket order with P2's
 *     `advanceToElimination` order, flip the filled bouts READY, and
 *     broadcast a draw-update event.
 *
 * The fill-in is idempotent: slots that already hold an athlete are never
 * touched, so a second trigger (or a race between two confirms) is a no-op.
 */

import { and, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  categoryAssignments,
  draws,
  kataGroupStandings,
  kataScores,
  matches,
  matchSlots,
} from "@/db/schema";
import {
  advanceToElimination,
  parseKataRankingMethod,
  rankGroupAthletes,
  type KataGroup,
  type KataGroupBoutResult,
  type KataGroupsSnapshot,
  type RankedKataAthlete,
} from "@/lib/draws/kataDraws";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { logger } from "@/lib/logger";
import { computeBoutDecisionFromRows, planEliminationFillIn } from "./decision";
import type { KataScoreRow } from "./scores";

/** The ring currently running a category (if any). */
async function ringIdForCategory(categoryId: string): Promise<string | null> {
  const [a] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.categoryId, categoryId),
        eq(categoryAssignments.status, "running")
      )
    )
    .limit(1);
  return a?.ringId ?? null;
}

async function loadKataGroupsSnapshot(categoryId: string): Promise<KataGroupsSnapshot | null> {
  const [draw] = await db
    .select({ kataGroups: draws.kataGroups, id: draws.id })
    .from(draws)
    .where(eq(draws.categoryId, categoryId))
    .limit(1);
  return (draw?.kataGroups as KataGroupsSnapshot | null) ?? null;
}

function snapshotGroupToKataGroup(g: { id: string; name: string; memberIds: string[] }): KataGroup {
  // rankGroupAthletes only reads registrationId; the display fields are
  // placeholders (the snapshot stores member ids only).
  return {
    id: g.id,
    name: g.name,
    members: g.memberIds.map((registrationId) => ({
      registrationId,
      displayName: "",
      clubId: "",
      districtId: null,
      seed: null,
    })),
  };
}

export interface ConfirmedGroupBout {
  matchId: string;
  groupId: string;
  akaId: string | null;
  aoId: string | null;
  winnerId: string | null;
  scores: KataScoreRow[];
}

/**
 * Pure mapping: confirmed group bouts -> P2 `KataGroupBoutResult` input.
 * Bouts missing athletes or a winner are skipped (defensive: a confirmed
 * bout should always have both, but a corrupt row must not poison the table).
 * Votes/totals are recomputed from the stored scores; when they cannot be
 * computed the win still counts with zero votes.
 */
export function toGroupBoutResults(bouts: readonly ConfirmedGroupBout[]): KataGroupBoutResult[] {
  const results: KataGroupBoutResult[] = [];
  for (const b of bouts) {
    if (!b.akaId || !b.aoId || !b.winnerId) continue;
    let akaVotes = 0;
    let aoVotes = 0;
    let akaScore = 0;
    let aoScore = 0;
    try {
      const d = computeBoutDecisionFromRows(b.scores);
      akaVotes = d.akaVotes;
      aoVotes = d.aoVotes;
      akaScore = d.akaTotal;
      aoScore = d.aoTotal;
    } catch {
      // Confirmed without countable votes (shouldn't happen — confirm
      // requires >=1 vote): the win still counts for victory points.
    }
    results.push({
      groupId: b.groupId,
      akaId: b.akaId,
      aoId: b.aoId,
      winnerId: b.winnerId,
      akaVotes,
      aoVotes,
      akaScore,
      aoScore,
    });
  }
  return results;
}

/**
 * Recompute one group's standings from its confirmed bouts and persist them.
 * Returns the ranked athletes (best first).
 */
export async function recomputeGroupStandings(
  categoryId: string,
  groupId: string
): Promise<RankedKataAthlete[]> {
  const snapshot = await loadKataGroupsSnapshot(categoryId);
  if (!snapshot) throw new Error("No kata group snapshot for this category");
  const snapGroup = snapshot.groups.find((g) => g.id === groupId);
  if (!snapGroup) throw new Error("Group not found in the draw snapshot");
  const group = snapshotGroupToKataGroup(snapGroup);

  const bouts = await db
    .select({
      id: matches.id,
      groupId: matches.groupId,
      winnerId: matches.winnerId,
    })
    .from(matches)
    .where(
      and(
        eq(matches.categoryId, categoryId),
        eq(matches.groupId, groupId),
        eq(matches.status, "CONFIRMED")
      )
    );

  const boutInputs: ConfirmedGroupBout[] = [];
  if (bouts.length > 0) {
    const matchIds = bouts.map((b) => b.id);
    const [allSlots, allScores] = await Promise.all([
      db
        .select({
          matchId: matchSlots.matchId,
          position: matchSlots.position,
          athleteId: matchSlots.athleteId,
        })
        .from(matchSlots)
        .where(inArray(matchSlots.matchId, matchIds)),
      db
        .select({
          matchId: kataScores.matchId,
          judgeRequestId: kataScores.judgeRequestId,
          seatNumber: kataScores.seatNumber,
          side: kataScores.side,
          scoreTenths: kataScores.scoreTenths,
        })
        .from(kataScores)
        .where(inArray(kataScores.matchId, matchIds)),
    ]);
    for (const b of bouts) {
      const slots = allSlots.filter((s) => s.matchId === b.id);
      boutInputs.push({
        matchId: b.id,
        groupId: b.groupId ?? groupId,
        akaId: slots.find((s) => s.position === 1)?.athleteId ?? null,
        aoId: slots.find((s) => s.position === 2)?.athleteId ?? null,
        winnerId: b.winnerId,
        scores: allScores
          .filter((s) => s.matchId === b.id)
          .map((s) => ({
            judgeRequestId: s.judgeRequestId,
            seatNumber: s.seatNumber,
            side: s.side,
            scoreTenths: s.scoreTenths,
          })),
      });
    }
  }

  const ranked = rankGroupAthletes(
    group,
    toGroupBoutResults(boutInputs),
    parseKataRankingMethod(snapshot.rankingMethod)
  );

  await db
    .insert(kataGroupStandings)
    .values({ categoryId, groupId, standings: ranked, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [kataGroupStandings.categoryId, kataGroupStandings.groupId],
      set: { standings: ranked, updatedAt: new Date() },
    });

  return ranked;
}

/** True when no group bout in the category is still undecided. */
export async function areAllGroupBoutsConfirmed(categoryId: string): Promise<boolean> {
  const [open] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.categoryId, categoryId),
        isNotNull(matches.groupId),
        notInArray(matches.status, ["CONFIRMED", "BYE"])
      )
    )
    .limit(1);
  return !open;
}

/**
 * Fill the TBD first-round elimination slots from the final group standings.
 * Only meaningful for GROUPS_THEN_ELIMINATION (ROUND_ROBIN has no
 * elimination stage; single elimination has no groups). Filled bouts flip to
 * READY so the ring queue picks them up.
 */
export async function fillEliminationBracket(
  categoryId: string
): Promise<{ filled: number }> {
  const snapshot = await loadKataGroupsSnapshot(categoryId);
  if (!snapshot || snapshot.format !== "GROUPS_THEN_ELIMINATION") {
    return { filled: 0 };
  }

  const rankedGroups: RankedKataAthlete[][] = [];
  for (const g of snapshot.groups) {
    rankedGroups.push(await recomputeGroupStandings(categoryId, g.id));
  }
  const advancerIds = advanceToElimination(rankedGroups, snapshot.advancePerGroup);

  const elimMatches = await db
    .select({ id: matches.id, matchNo: matches.matchNo, status: matches.status })
    .from(matches)
    .where(
      and(
        eq(matches.categoryId, categoryId),
        isNull(matches.groupId),
        eq(matches.bracketType, "MAIN")
      )
    );
  if (elimMatches.length === 0) return { filled: 0 };
  const matchIds = elimMatches.map((m) => m.id);
  const slots = await db
    .select({
      matchId: matchSlots.matchId,
      position: matchSlots.position,
      slotType: matchSlots.slotType,
      athleteId: matchSlots.athleteId,
    })
    .from(matchSlots)
    .where(inArray(matchSlots.matchId, matchIds));

  // First round = matches whose slots are all ATHLETE (later rounds are
  // WINNER_OF-wired). Placeholders carry athleteId null.
  const matchNoById = new Map(elimMatches.map((m) => [m.id, m.matchNo]));
  const firstRoundIds = new Set(
    elimMatches
      .filter((m) =>
        slots
          .filter((s) => s.matchId === m.id)
          .every((s) => s.slotType === "ATHLETE")
      )
      .map((m) => m.id)
  );
  const plan = planEliminationFillIn(
    slots
      .filter((s) => firstRoundIds.has(s.matchId))
      .map((s) => ({
        matchId: s.matchId,
        matchNo: matchNoById.get(s.matchId) ?? 0,
        position: s.position as 1 | 2,
        slotType: s.slotType,
        athleteId: s.athleteId,
      })),
    advancerIds
  );

  const touchedMatchIds = new Set<string>();
  for (const a of plan) {
    await db
      .update(matchSlots)
      .set({ athleteId: a.athleteId })
      .where(
        and(eq(matchSlots.matchId, a.matchId), eq(matchSlots.position, a.position))
      );
    touchedMatchIds.add(a.matchId);
  }

  // Flip fully-filled bouts to READY (they were SCHEDULED placeholders).
  for (const m of elimMatches) {
    if (!touchedMatchIds.has(m.id)) continue;
    if (m.status === "CONFIRMED" || m.status === "BYE" || m.status === "LIVE") continue;
    const filled = slots.filter((s) => s.matchId === m.id);
    const filledAthletes = filled.filter(
      (s) =>
        s.athleteId != null ||
        plan.some((p) => p.matchId === m.id && p.position === s.position)
    );
    if (filled.length === 2 && filledAthletes.length === 2) {
      await db.update(matches).set({ status: "READY" }).where(eq(matches.id, m.id));
    }
  }

  if (plan.length > 0) {
    const [cat] = await db
      .select({ tournamentId: categories.tournamentId })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);
    const ringId = await ringIdForCategory(categoryId);
    broadcastLiveEvent({
      table: "draws",
      op: "UPDATE",
      categoryId,
      ringId: ringId ?? undefined,
      tournamentId: cat?.tournamentId,
      status: "elimination-filled",
      data: { filled: plan.length },
    });
  }

  return { filled: plan.length };
}

/**
 * After a group bout is confirmed: recompute that group's standings, and if
 * every group bout in the category is now CONFIRMED, fill the elimination
 * bracket. Returns whether the fill-in ran and how many slots it filled.
 *
 * If the fill-in itself fails, the error is NOT swallowed into silence: the
 * bout stays confirmed (its standings are already persisted) and `fillError`
 * is set so the UI can offer the `retryEliminationFill` moderator action.
 */
export async function confirmGroupBoutFollowUp(
  categoryId: string,
  groupId: string
): Promise<{
  standings: RankedKataAthlete[];
  fillTriggered: boolean;
  filled: number;
  fillError: boolean;
}> {
  const standings = await recomputeGroupStandings(categoryId, groupId);
  if (!(await areAllGroupBoutsConfirmed(categoryId))) {
    return { standings, fillTriggered: false, filled: 0, fillError: false };
  }
  try {
    const { filled } = await fillEliminationBracket(categoryId);
    return { standings, fillTriggered: true, filled, fillError: false };
  } catch (err) {
    // The standings are already persisted; a fill-in failure must not fail
    // the confirmation (the bout really is confirmed — failing here would
    // leave the moderator retrying an "already confirmed" bout forever).
    logger.error({ err, categoryId }, "[judge] elimination fill-in failed after group stage completed");
    return { standings, fillTriggered: true, filled: 0, fillError: true };
  }
}
