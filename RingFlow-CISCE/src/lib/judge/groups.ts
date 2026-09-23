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

import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  categoryAssignments,
  draws,
  drawVersions,
  judgeRequests,
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
import type { DrawGraph } from "@/engine/draw-engine/types";
import { checksumOf } from "@/engine/draw-engine/canonical";
import { computeBoutDecisionFromRows, planEliminationFillIn } from "./decision";
import type { BoutDecisionExtras } from "./decision";
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
  disqualifiedSide: "AKA" | "AO" | null;
}

/**
 * Pure mapping: confirmed group bouts -> P2 `KataGroupBoutResult` input.
 * Bouts missing athletes or a winner are skipped (defensive: a confirmed
 * bout should always have both, but a corrupt row must not poison the table).
 * Votes/totals are recomputed from the stored scores; when they cannot be
 * computed the win still counts with zero votes.
 */
export function toGroupBoutResults(
  bouts: readonly ConfirmedGroupBout[],
  extrasByMatch?: ReadonlyMap<string, BoutDecisionExtras>
): KataGroupBoutResult[] {
  const results: KataGroupBoutResult[] = [];
  for (const b of bouts) {
    if (!b.akaId || !b.aoId || !b.winnerId) continue;
    let akaVotes = 0;
    let aoVotes = 0;
    let akaScore = 0;
    let aoScore = 0;
    try {
      const d = computeBoutDecisionFromRows(
        b.scores,
        {},
        extrasByMatch?.get(b.matchId) ?? {
          disqualifiedSide: b.disqualifiedSide,
        }
      );
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
      disqualifiedSide: matches.disqualifiedSide,
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
        disqualifiedSide:
          b.disqualifiedSide === "AKA" || b.disqualifiedSide === "AO"
            ? b.disqualifiedSide
            : null,
      });
    }
  }

  // M2/M4: recompute votes/totals through the same lens as the decision —
  // only the seats' CURRENT occupants' marks count, and a disqualified
  // side's marks become 0.0 with the opponent awarded the win.
  const extrasByMatch = new Map<string, BoutDecisionExtras>();
  const ringId = await ringIdForCategory(categoryId);
  let currentBySeat: Map<number, string> | undefined;
  if (ringId) {
    const approved = await db
      .select({ id: judgeRequests.id, seatNumber: judgeRequests.seatNumber })
      .from(judgeRequests)
      .where(
        and(eq(judgeRequests.ringId, ringId), eq(judgeRequests.status, "approved"))
      );
    currentBySeat = new Map(
      approved
        .filter((r) => r.seatNumber != null)
        .map((r) => [r.seatNumber as number, r.id])
    );
  }
  for (const b of boutInputs) {
    extrasByMatch.set(b.matchId, {
      currentBySeat,
      disqualifiedSide: b.disqualifiedSide,
    });
  }

  const ranked = rankGroupAthletes(
    group,
    toGroupBoutResults(boutInputs, extrasByMatch),
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
 * READY so the ring queue picks them up; (ATHLETE, BYE) matches are marked
 * BYE walkovers with the athlete advanced. The filled athletes are also
 * written back into the draw graph as a NEW draw version, so `resolveDraw`
 * sees them.
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

  // First round = matches with no wired slots (later rounds are
  // WINNER_OF-wired). Structural BYE slots count as first round too —
  // (ATHLETE, BYE) matches are walkovers, not later-round bouts.
  // Placeholders carry athleteId null.
  const matchNoById = new Map(elimMatches.map((m) => [m.id, m.matchNo]));
  const firstRoundIds = new Set(
    elimMatches
      .filter((m) =>
        slots
          .filter((s) => s.matchId === m.id)
          .every((s) => s.slotType === "ATHLETE" || s.slotType === "BYE")
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

  // B2: (ATHLETE, BYE) first-round matches are walkovers — the lone athlete
  // advances without a contest. Mark them BYE (a final status, so the ring
  // queue and progress bars skip them) with the winner recorded, and feed
  // the athlete into the next round's WINNER_OF slot immediately — the same
  // athlete the draw-engine graph walk would propagate on the next confirm
  // (idempotent: later resolutions write the same value).
  const filledBySlot = new Map(
    plan.map((p) => [`${p.matchId}:${p.position}`, p.athleteId])
  );
  const athleteInSlot = (matchId: string, position: number): string | null =>
    filledBySlot.get(`${matchId}:${position}`) ??
    slots.find((s) => s.matchId === matchId && s.position === position)?.athleteId ??
    null;
  let walkovers = 0;
  for (const m of elimMatches) {
    if (!firstRoundIds.has(m.id)) continue;
    if (m.status === "CONFIRMED" || m.status === "BYE" || m.status === "LIVE") continue;
    const matchSlotsNow = slots.filter((s) => s.matchId === m.id);
    if (matchSlotsNow.length !== 2) continue;
    const withAthletes = matchSlotsNow.map((s) => ({
      ...s,
      athleteId: athleteInSlot(s.matchId, s.position),
    }));
    const athleteSlots = withAthletes.filter(
      (s) => s.slotType === "ATHLETE" && s.athleteId != null
    );
    const byeSlots = withAthletes.filter((s) => s.slotType === "BYE");
    if (athleteSlots.length !== 1 || byeSlots.length !== 1) continue;
    const adv = athleteSlots[0]!;
    await db
      .update(matches)
      .set({
        status: "BYE",
        winnerId: adv.athleteId,
        winnerSide: adv.position === 1 ? "AKA" : "AO",
      })
      .where(eq(matches.id, m.id));
    // Feed the athlete into the next round's WINNER_OF slot immediately —
    // the same athlete the draw-engine graph walk propagates on the next
    // confirm (idempotent: later resolutions write the same value). Never
    // touch a downstream match that is already LIVE/CONFIRMED/BYE: its
    // bracket history is final.
    const downstream = await db
      .select({ matchId: matchSlots.matchId })
      .from(matchSlots)
      .innerJoin(matches, eq(matches.id, matchSlots.matchId))
      .where(
        and(
          eq(matchSlots.slotType, "WINNER_OF"),
          eq(matchSlots.sourceMatchId, m.id),
          notInArray(matches.status, ["LIVE", "CONFIRMED", "BYE"])
        )
      );
    for (const d of downstream) {
      await db
        .update(matchSlots)
        .set({ athleteId: adv.athleteId })
        .where(
          and(
            eq(matchSlots.matchId, d.matchId),
            eq(matchSlots.slotType, "WINNER_OF"),
            eq(matchSlots.sourceMatchId, m.id)
          )
        );
    }
    walkovers += 1;
  }

  // B1: write the filled athletes back into the stored draw graph. The draw
  // view (`resolveDraw` via `assembleCategoryDraw`) is pure from the latest
  // graph version — without this, TBD slots stay null, first-round bouts
  // resolve UNRESOLVED, and winners never propagate. Draw versions are
  // immutable history: a NEW version row is written (the locked version is
  // never mutated) and `draws.version` is bumped to it.
  const finalAthleteBySlot = new Map<string, string>();
  for (const s of slots) {
    const athleteId = athleteInSlot(s.matchId, s.position);
    if (s.slotType === "ATHLETE" && athleteId) {
      finalAthleteBySlot.set(`${s.matchId}:${s.position}`, athleteId);
    }
  }
  await writeEliminationFillGraphVersion(categoryId, finalAthleteBySlot);

  if (plan.length > 0 || walkovers > 0) {
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
      data: { filled: plan.length, walkovers },
    });
  }

  return { filled: plan.length };
}

/**
 * B1 helper: patch the stored draw graph with the elimination fill-in.
 *
 * `finalAthleteBySlot` maps `${matchId}:${position}` -> athleteId for every
 * filled first-round ATHLETE slot. The latest graph version is deep-cloned,
 * its ATHLETE slots' `registrationId`s patched, the checksum recomputed, and
 * a NEW `draw_versions` row written (the stored versions are immutable —
 * the locked version is never mutated in place); `draws.version` advances to
 * the new row. No-op when nothing differs (idempotent retries).
 */
async function writeEliminationFillGraphVersion(
  categoryId: string,
  finalAthleteBySlot: ReadonlyMap<string, string>
): Promise<void> {
  if (finalAthleteBySlot.size === 0) return;
  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId))
    .limit(1);
  if (!draw) return;
  const [latest] = await db
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);
  if (!latest) return;

  const graph = structuredClone(latest.graph) as unknown as DrawGraph;
  let changed = false;
  for (const gs of graph.slots) {
    if (gs.slotType !== "ATHLETE") continue;
    const athleteId = finalAthleteBySlot.get(`${gs.matchId}:${gs.position}`);
    if (athleteId && gs.registrationId !== athleteId) {
      gs.registrationId = athleteId;
      changed = true;
    }
  }
  if (!changed) return;

  const { checksum: _previous, ...body } = graph;
  const patched: DrawGraph = { ...body, checksum: checksumOf(body) };
  const version = latest.version + 1;
  await db.insert(drawVersions).values({
    drawId: draw.id,
    version,
    graph: patched as unknown as Record<string, unknown>,
    checksum: patched.checksum,
    reason: "Group-stage elimination fill-in",
  });
  await db.update(draws).set({ version }).where(eq(draws.id, draw.id));
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
