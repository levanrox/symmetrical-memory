"use server";

import { db } from "@/db";
import {
  categoryAssignments,
  categories,
  matches,
  matchEvents,
  matchSlots,
  rings,
  athletes,
  draws,
  drawVersions,
  tournaments,
} from "@/db/schema";
import { resolveDraw } from "@/engine/draw-engine";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { normalizeClock } from "@/lib/matchClock";
import { resolveConfirmOutcome, clampScore, assertMatchRingBinding } from "@/lib/boutGuards";
import { logger } from "@/lib/logger";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { cookies } from "next/headers";
import { ensureAdmin } from "./admin";
import { ensureOrganiser } from "./organiser";
import { validateModeratorSession } from "./moderator";

/**
 * Authorize a bout write for a ring. Accepts, in order:
 *  1. a valid moderator session for this ring (mod_token cookie),
 *  2. a signed admin session,
 *  3. a signed organiser session.
 * Throws otherwise. Every score mutation goes through this — there is no
 * unauthenticated path to rewrite live scores.
 */
async function authorizeBoutWrite(ringId: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("mod_token")?.value;
    if (token) {
      const session = await validateModeratorSession(ringId, token);
      if (session) return;
    }
  } catch {}
  try {
    await ensureAdmin();
    return;
  } catch {}
  try {
    await ensureOrganiser();
    return;
  } catch {}
  throw new Error("Not authorized to update this bout");
}

/** Resolve the ring currently running a match's category (if any). */
async function ringIdForMatch(matchId: string): Promise<string | null> {
  const [m] = await db
    .select({ categoryId: matches.categoryId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!m) return null;
  const [a] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.categoryId, m.categoryId),
        eq(categoryAssignments.status, "running")
      )
    )
    .limit(1);
  return a?.ringId ?? null;
}

function assembleRingActiveBout({
  ring,
  tournament,
  assignment,
  category,
  hasDraw,
  allMatches,
  allSlots,
  athleteMap,
  targetMatchId,
}: {
  ring: any;
  tournament: any;
  assignment: any;
  category: any;
  hasDraw: boolean;
  allMatches: any[];
  allSlots: any[];
  athleteMap: Map<string, any>;
  targetMatchId?: string | null;
}) {
  if (!hasDraw) {
    return {
      tournament: tournament || null,
      ring,
      assignment,
      category,
      hasDraw: false,
      currentMatch: null,
      nextBout: null,
      matches: [],
      clock: normalizeClock(ring),
      serverNow: Date.now(),
    };
  }

  const enrichedMatches = allMatches.map((m) => {
    const slots = allSlots.filter((s) => s.matchId === m.id);
    const akaSlot = slots.find((s) => s.position === 1);
    const aoSlot = slots.find((s) => s.position === 2);
    const akaAth = akaSlot?.athleteId ? athleteMap.get(akaSlot.athleteId) : null;
    const aoAth = aoSlot?.athleteId ? athleteMap.get(aoSlot.athleteId) : null;

    const isReady =
      Boolean(akaAth && aoAth) &&
      m.status !== "CONFIRMED" &&
      m.status !== "BYE";
    const isFinished = m.status === "CONFIRMED" || m.status === "BYE";

    return {
      ...m,
      aka: akaAth
        ? { id: akaAth.id, name: akaAth.name, school: akaAth.school || akaAth.dojo || "", chestNumber: akaAth.chestNumber }
        : { id: null, name: "TBD", school: "", chestNumber: null },
      ao: aoAth
        ? { id: aoAth.id, name: aoAth.name, school: aoAth.school || aoAth.dojo || "", chestNumber: aoAth.chestNumber }
        : { id: null, name: "TBD", school: "", chestNumber: null },
      isReady,
      isFinished,
    };
  });

  // Identify fighters who recently competed to ensure rest time
  const recentFighterIds = new Set<string>();
  const lastFinishedMatch = enrichedMatches
    .filter((m) => m.status === "CONFIRMED")
    .sort((a, b) => (b.matchNo ?? 0) - (a.matchNo ?? 0))[0];
  if (lastFinishedMatch) {
    if (lastFinishedMatch.aka?.id) recentFighterIds.add(lastFinishedMatch.aka.id);
    if (lastFinishedMatch.ao?.id) recentFighterIds.add(lastFinishedMatch.ao.id);
  }

  // Sort candidate ready bouts:
  // 1. Neither fighter has just fought (fresh / rested fighters first)
  // 2. Bout match number order
  const sortReadyBouts = (bouts: typeof enrichedMatches) => {
    return [...bouts].sort((a, b) => {
      const aHasRecent = (a.aka?.id && recentFighterIds.has(a.aka.id)) || (a.ao?.id && recentFighterIds.has(a.ao.id));
      const bHasRecent = (b.aka?.id && recentFighterIds.has(b.aka.id)) || (b.ao?.id && recentFighterIds.has(b.ao.id));
      if (!aHasRecent && bHasRecent) return -1;
      if (aHasRecent && !bHasRecent) return 1;
      return a.matchNo - b.matchNo;
    });
  };

  let targetMatch = null;
  if (targetMatchId) {
    targetMatch = enrichedMatches.find((m) => m.id === targetMatchId) || null;
  }
  if (!targetMatch && ring?.currentMatchId) {
    targetMatch = enrichedMatches.find((m) => m.id === ring.currentMatchId) || null;
  }
  if (!targetMatch) {
    const readyBouts = sortReadyBouts(enrichedMatches.filter((m) => m.isReady));
    targetMatch =
      enrichedMatches.find((m) => m.status === "LIVE") ||
      readyBouts[0] ||
      enrichedMatches.find((m) => !m.isFinished) ||
      enrichedMatches[0] ||
      null;
  }

  // Add currently active fighters to recent fighters for nextBout consideration
  if (targetMatch) {
    if (targetMatch.aka?.id) recentFighterIds.add(targetMatch.aka.id);
    if (targetMatch.ao?.id) recentFighterIds.add(targetMatch.ao.id);
  }

  const candidateNextBouts = sortReadyBouts(
    enrichedMatches.filter((m) => m.isReady && m.id !== targetMatch?.id)
  );
  const nextBout = candidateNextBouts[0] || null;

  return {
    tournament: tournament || null,
    ring,
    assignment,
    category,
    hasDraw: true,
    currentMatch: targetMatch,
    nextBout,
    matches: enrichedMatches,
    clock: normalizeClock(ring),
    serverNow: Date.now(),
  };
}

export async function getRingActiveBout(ringId: string, matchId?: string) {
  // 1. Fetch ring info
  const [ring] = await db
    .select()
    .from(rings)
    .where(eq(rings.id, ringId));

  if (!ring) return null;

  const [tournament] = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      showPublicDraws: tournaments.showPublicDraws,
    })
    .from(tournaments)
    .where(eq(tournaments.id, ring.tournamentId));

  // 2. Find active category assignment on this ring
  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.ringId, ringId),
        inArray(categoryAssignments.status, ["running", "paused", "pending"])
      )
    )
    .orderBy(categoryAssignments.queueOrder)
    .limit(1);

  if (!assignment) return null;

  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, assignment.categoryId));

  if (!cat) return null;

  // 3. Check if category has a draw
  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, cat.id));

  if (!draw) {
    return assembleRingActiveBout({
      ring,
      tournament,
      assignment,
      category: cat,
      hasDraw: false,
      allMatches: [],
      allSlots: [],
      athleteMap: new Map(),
    });
  }

  // 4. Fetch all matches for this category
  const allMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.categoryId, cat.id))
    .orderBy(matches.matchNo);

  const allSlots =
    allMatches.length > 0
      ? await db
          .select()
          .from(matchSlots)
          .where(
            inArray(
              matchSlots.matchId,
              allMatches.map((m) => m.id)
            )
          )
      : [];

  const relevantAthleteIds = Array.from(
    new Set(allSlots.map((s) => s.athleteId).filter((id): id is string => Boolean(id)))
  );

  const relevantAthletes =
    relevantAthleteIds.length > 0
      ? await db
          .select()
          .from(athletes)
          .where(inArray(athletes.id, relevantAthleteIds))
      : [];

  const athleteMap = new Map(relevantAthletes.map((a) => [a.id, a]));

  return assembleRingActiveBout({
    ring,
    tournament,
    assignment,
    category: cat,
    hasDraw: true,
    allMatches,
    allSlots,
    athleteMap,
    targetMatchId: matchId,
  });
}

export async function setActiveBout(ringId: string, matchId: string) {
  await authorizeBoutWrite(ringId);

  // Ring binding: the bout must belong to a category assigned to THIS ring.
  // Otherwise a moderator for ring A could hijack ring B's scoreboard by
  // pointing ring A's active-bout pointer at ring B's matches.
  const [target] = await db
    .select({ id: matches.id, categoryId: matches.categoryId, status: matches.status })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!target) throw new Error("Match not found");
  const [binding] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.categoryId, target.categoryId),
        eq(categoryAssignments.ringId, ringId)
      )
    )
    .limit(1);
  if (!binding) {
    throw new Error("Match does not belong to this ring");
  }

  // Update ring's active match pointer
  await db
    .update(rings)
    .set({ currentMatchId: matchId })
    .where(eq(rings.id, ringId));

  // Set match to LIVE if it's not already confirmed
  if (target.status !== "CONFIRMED" && target.status !== "BYE") {
    await db
      .update(matches)
      .set({ status: "LIVE" })
      .where(eq(matches.id, matchId));
  }

  try {
    revalidatePath(`/moderator/ring/${ringId}/current`);
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {}

  // Broadcast instantly so scoreboard and mod desk switch bouts with zero latency
  broadcastLiveEvent({
    table: "rings",
    op: "UPDATE",
    id: ringId,
    ringId,
    matchId,
    data: { currentMatchId: matchId },
  });

  return { success: true };
}

export async function updateLiveMatchState(
  matchId: string,
  ringId: string,
  state: {
    akaScore?: number;
    aoScore?: number;
    akaPenalties?: number;
    aoPenalties?: number;
    senshu?: "AKA" | "AO" | null;
  }
) {
  await authorizeBoutWrite(ringId);

  // Ring binding: a moderator token is valid for its own ring only. Without
  // this, a ring-A moderator could rewrite ring-B scores by passing ring A
  // while naming a ring-B match.
  assertMatchRingBinding(await ringIdForMatch(matchId), ringId);

  // Serialize concurrent writers on the match row: SELECT ... FOR UPDATE inside
  // a transaction, so two moderators' adjustments can't interleave into a
  // lost update. A CONFIRMED bout is final — live state may not overwrite it.
  const persisted = await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`select id, status from matches where id = ${matchId} for update`
    );
    const current = (locked as unknown as { id: string; status: string }[])[0];
    if (!current) throw new Error("Match not found");
    if (current.status === "CONFIRMED") {
      throw new Error("Match is already confirmed; live scores can no longer be changed");
    }

    const next = {
      akaScore: clampScore(state.akaScore, "akaScore"),
      aoScore: clampScore(state.aoScore, "aoScore"),
      akaPenalties: clampScore(state.akaPenalties, "akaPenalties"),
      aoPenalties: clampScore(state.aoPenalties, "aoPenalties"),
      senshu: state.senshu ?? null,
      status: "LIVE" as const,
    };
    await tx.update(matches).set(next).where(eq(matches.id, matchId));
    return next;
  });

  try {
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {}

  // Immediate zero-latency push directly to scoreboard and moderator SSE streams
  broadcastLiveEvent({
    table: "matches",
    op: "UPDATE",
    id: matchId,
    matchId,
    ringId,
    akaScore: persisted.akaScore,
    aoScore: persisted.aoScore,
    akaPenalties: persisted.akaPenalties,
    aoPenalties: persisted.aoPenalties,
    senshu: persisted.senshu,
    status: "LIVE",
  });

  return { success: true, state: persisted };
}

export async function confirmBoutResult(
  matchId: string,
  winnerId: string,
  details?: {
    side?: "AKA" | "AO";
    akaPoints?: number;
    aoPoints?: number;
    akaPenalties?: number;
    aoPenalties?: number;
    senshu?: "AKA" | "AO" | null;
    method?: string;
  },
  opts?: {
    /** Ring the bout is being confirmed from (moderator context). */
    ringId?: string;
    /**
     * Client-generated idempotency key (uuid, one per confirm attempt —
     * see BoutScoringPad). Contract:
     * - First call with a key: runs the confirmation, stores the key on the
     *   match event's `commandId` column.
     * - Retry/double-click with the SAME key: the pre-check finds the stored
     *   event and returns `{ duplicate: true }` without re-running bracket
     *   advancement or inserting a second event.
     * - A key is only ever valid for its match (scoped by matchId).
     */
    idempotencyKey?: string;
  }
) {
  // Authorize: prefer the caller's ring context, else resolve the ring running
  // this category; without any ring context only admin/organiser may confirm.
  const ringId = opts?.ringId ?? (await ringIdForMatch(matchId));
  if (opts?.ringId) {
    // Ring binding: a moderator token is valid for its own ring only — the
    // claimed ring must be the ring actually running this match.
    assertMatchRingBinding(await ringIdForMatch(matchId), opts.ringId);
  }
  if (ringId) {
    await authorizeBoutWrite(ringId);
  } else {
    try {
      await ensureAdmin();
    } catch {
      await ensureOrganiser();
    }
  }

  // 1. Fetch match
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId));

  if (!match) throw new Error("Match not found");

  const categoryId = match.categoryId;

  // 2. Fetch category and draw graph
  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  if (!draw) throw new Error("Draw not found");

  const [latestVersion] = await db
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);

  if (!latestVersion) throw new Error("Draw version not found");

  const graph = latestVersion.graph as unknown as DrawGraph;

  // Fetch slots for this match to resolve winning side accurately
  const currentSlots = await db
    .select()
    .from(matchSlots)
    .where(eq(matchSlots.matchId, matchId));

  const akaSlot = currentSlots.find((s) => s.position === 1);
  const aoSlot = currentSlots.find((s) => s.position === 2);

  let winningSide: "AKA" | "AO" = details?.side || "AKA";
  if (winnerId === akaSlot?.athleteId) {
    winningSide = "AKA";
  } else if (winnerId === aoSlot?.athleteId) {
    winningSide = "AO";
  }

  // 3. Commit match confirmation in transaction. The match row is locked
  // first so two concurrent confirmations can't both advance the bracket.
  // Idempotency: a retry with the same winner returns { duplicate: true }
  // instead of re-running; a *different* winner on an already-confirmed bout
  // is a conflict and is refused.
  const outcome = await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`select id, status, "winner_id" as "winnerId" from matches where id = ${matchId} for update`
    );
    const current = (
      locked as unknown as { id: string; status: string; winnerId: string | null }[]
    )[0];
    if (!current) throw new Error("Match not found");

    const decision = resolveConfirmOutcome(current.status, current.winnerId, winnerId);
    if (decision === "duplicate") {
      return { duplicate: true as const };
    }
    if (decision === "conflict") {
      throw new Error(
        "This bout was already confirmed with a different winner. Refresh and try again."
      );
    }

    // Optional client idempotency key: if an event with this key already
    // exists for the match, this is a replay of a completed confirmation.
    if (opts?.idempotencyKey) {
      const prior = await tx
        .select({ id: matchEvents.id })
        .from(matchEvents)
        .where(
          and(
            eq(matchEvents.matchId, matchId),
            eq(matchEvents.commandId, opts.idempotencyKey)
          )
        )
        .limit(1);
      if (prior.length > 0) {
        return { duplicate: true as const };
      }
    }

    // Update match status, winner, points and penalties
    await tx
      .update(matches)
      .set({
        status: "CONFIRMED",
        winnerId,
        winnerSide: winningSide,
        akaScore: details?.akaPoints ?? 0,
        aoScore: details?.aoPoints ?? 0,
        akaPenalties: details?.akaPenalties ?? 0,
        aoPenalties: details?.aoPenalties ?? 0,
        senshu: details?.senshu ?? null,
        decisionMethod: details?.method || "POINTS",
      })
      .where(eq(matches.id, matchId));

    // Record match event (carries the idempotency key when the client sent one)
    await tx.insert(matchEvents).values({
      matchId,
      seq: 1,
      type: "RESULT_CONFIRMED",
      commandId: opts?.idempotencyKey ?? null,
      payload: {
        winnerId,
        side: winningSide,
        akaPoints: details?.akaPoints ?? 0,
        aoPoints: details?.aoPoints ?? 0,
        method: details?.method || "POINTS",
        senshu: details?.senshu ?? null,
      },
    });

    // 4. Bracket advancement: resolve graph with ALL confirmed outcomes
    const allMatches = await tx
      .select()
      .from(matches)
      .where(eq(matches.categoryId, categoryId));

    const allSlots = await tx
      .select()
      .from(matchSlots)
      .where(
        inArray(
          matchSlots.matchId,
          allMatches.map((m) => m.id)
        )
      );

    const outcomes = new Map<string, { kind: "WINNER"; side: "AKA" | "AO" }>();
    for (const m of allMatches) {
      const isCurrent = m.id === matchId;
      const wId = isCurrent ? winnerId : m.winnerId;
      if (wId) {
        let side: "AKA" | "AO" = isCurrent ? winningSide : (m.winnerSide as "AKA" | "AO") || "AKA";
        if (!isCurrent && !m.winnerSide) {
          const slots = allSlots.filter((s) => s.matchId === m.id);
          const aka = slots.find((s) => s.position === 1);
          side = wId === aka?.athleteId ? "AKA" : "AO";
        }
        outcomes.set(m.id, {
          kind: "WINNER",
          side,
        });
      }
    }

    const resolved = resolveDraw(graph, outcomes);

    // Update slots in dependent matches with the advancing athlete
    for (const rm of resolved.matches) {
      const akaId = rm.slots[0]?.registrationId;
      const aoId = rm.slots[1]?.registrationId;

      if (akaId) {
        await tx
          .update(matchSlots)
          .set({ athleteId: akaId })
          .where(
            and(
              eq(matchSlots.matchId, rm.matchId),
              eq(matchSlots.position, 1)
            )
          );
      }
      if (aoId) {
        await tx
          .update(matchSlots)
          .set({ athleteId: aoId })
          .where(
            and(
              eq(matchSlots.matchId, rm.matchId),
              eq(matchSlots.position, 2)
            )
          );
      }

      // Update match status if both athletes are ready or if walkover
      if (rm.status && rm.status !== "PENDING" && rm.status !== "UNRESOLVED") {
        await tx
          .update(matches)
          .set({ status: rm.status })
          .where(and(eq(matches.id, rm.matchId), sql`status != 'CONFIRMED'`));
      }
    }

    // 5. matchesCompleted counts bouts actually fought, so it lines up with the
    //    expected_matches the draw wrote (which excludes byes/walkovers).
    const totalConfirmed = allMatches.filter(
      (m) => (m.id === matchId || m.status === "CONFIRMED") && m.status !== "BYE"
    ).length;

    const [assignment] = await tx
      .select()
      .from(categoryAssignments)
      .where(eq(categoryAssignments.categoryId, categoryId));

    if (assignment) {
      await tx
        .update(categoryAssignments)
        .set({ matchesCompleted: totalConfirmed })
        .where(eq(categoryAssignments.id, assignment.id));

      // Reset rings.currentMatchId so the next ready bout gets picked automatically
      await tx
        .update(rings)
        .set({ currentMatchId: null })
        .where(eq(rings.id, assignment.ringId));

      broadcastLiveEvent({
        table: "matches",
        op: "UPDATE",
        id: matchId,
        matchId,
        ringId: assignment.ringId,
        categoryId,
        status: "CONFIRMED",
      });
      broadcastLiveEvent({
        table: "category_assignments",
        op: "UPDATE",
        ringId: assignment.ringId,
        categoryId,
      });
    }

    return { duplicate: false as const };
  });

  if (outcome.duplicate) {
    // Idempotent replay: the bout was already confirmed (same winner or same
    // idempotency key). Report success without re-running bracket advancement.
    return { success: true, duplicate: true };
  }

  return { success: true };
}

export async function getTournamentActiveBouts(tournamentId: string) {
  const [tournamentRows, ringRows] = await Promise.all([
    db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        showPublicDraws: tournaments.showPublicDraws,
      })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(rings)
      .where(eq(rings.tournamentId, tournamentId))
      .orderBy(rings.ringOrder),
  ]);

  if (ringRows.length === 0) return {};
  const tournament = tournamentRows[0] || null;
  const ringIds = ringRows.map((r) => r.id);

  // Fetch all active assignments across all rings in a single query
  const allActiveAssignments = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        inArray(categoryAssignments.ringId, ringIds),
        inArray(categoryAssignments.status, ["running", "paused", "pending"])
      )
    )
    .orderBy(categoryAssignments.queueOrder);

  // Map lowest queue_order active assignment per ring
  const ringAssignmentMap = new Map<string, any>();
  for (const a of allActiveAssignments) {
    if (!ringAssignmentMap.has(a.ringId)) {
      ringAssignmentMap.set(a.ringId, a);
    }
  }

  const categoryIds = Array.from(
    new Set(Array.from(ringAssignmentMap.values()).map((a) => a.categoryId).filter(Boolean))
  );

  if (categoryIds.length === 0) return {};

  // Batch query categories, draws, and matches for all active categories in parallel
  const [catRows, drawRows, matchRows] = await Promise.all([
    db.select().from(categories).where(inArray(categories.id, categoryIds)),
    db.select().from(draws).where(inArray(draws.categoryId, categoryIds)),
    db.select().from(matches).where(inArray(matches.categoryId, categoryIds)).orderBy(matches.matchNo),
  ]);

  const catMap = new Map(catRows.map((c) => [c.id, c]));
  const drawSet = new Set(drawRows.map((d) => d.categoryId));

  const matchIds = matchRows.map((m) => m.id);
  const slotRows =
    matchIds.length > 0
      ? await db.select().from(matchSlots).where(inArray(matchSlots.matchId, matchIds))
      : [];

  const athleteIds = Array.from(
    new Set(slotRows.map((s) => s.athleteId).filter((id): id is string => Boolean(id)))
  );

  const athleteRows =
    athleteIds.length > 0
      ? await db.select().from(athletes).where(inArray(athletes.id, athleteIds))
      : [];
  const athleteMap = new Map(athleteRows.map((a) => [a.id, a]));

  // Assemble bout map in memory (0 ms overhead)
  const boutMap: Record<string, any> = {};
  for (const ring of ringRows) {
    const assignment = ringAssignmentMap.get(ring.id);
    if (!assignment) continue;
    const cat = catMap.get(assignment.categoryId);
    if (!cat) continue;

    const hasDraw = drawSet.has(cat.id);
    const catMatches = matchRows.filter((m) => m.categoryId === cat.id);
    const catMatchIds = new Set(catMatches.map((m) => m.id));
    const catSlots = slotRows.filter((s) => catMatchIds.has(s.matchId));

    boutMap[ring.id] = assembleRingActiveBout({
      ring,
      tournament,
      assignment,
      category: cat,
      hasDraw,
      allMatches: catMatches,
      allSlots: catSlots,
      athleteMap,
    });
  }

  return boutMap;
}
