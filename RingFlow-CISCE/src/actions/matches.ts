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
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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
    return {
      tournament: tournament || null,
      ring,
      assignment,
      category: cat,
      hasDraw: false,
      currentMatch: null,
      nextBout: null,
      matches: [],
      clock: normalizeClock(ring),
      serverNow: Date.now(),
    };
  }

  // 4. Fetch all matches for this category
  const allMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.categoryId, cat.id))
    .orderBy(matches.matchNo);

  const allSlots = await db
    .select()
    .from(matchSlots)
    .where(
      inArray(
        matchSlots.matchId,
        allMatches.map((m) => m.id)
      )
    );

  const allAthletes = await db.select().from(athletes);
  const athleteMap = new Map(allAthletes.map((a) => [a.id, a]));

  // Build structured matches list for moderator roster & switcher
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

  // 5. Select active match (requested matchId > ring.currentMatchId > LIVE > first READY > first not CONFIRMED)
  let targetMatch = null;
  if (matchId) {
    targetMatch = enrichedMatches.find((m) => m.id === matchId) || null;
  }
  if (!targetMatch && ring?.currentMatchId) {
    targetMatch = enrichedMatches.find((m) => m.id === ring.currentMatchId) || null;
  }
  if (!targetMatch) {
    targetMatch =
      enrichedMatches.find((m) => m.status === "LIVE") ||
      enrichedMatches.find((m) => m.isReady) ||
      enrichedMatches.find((m) => !m.isFinished) ||
      enrichedMatches[0] ||
      null;
  }

  // 6. The bout after the current one, for the arena "next up" strip.
  const nextBout =
    enrichedMatches
      .filter((m) => m.isReady && m.id !== targetMatch?.id)
      .sort((a, b) => a.matchNo - b.matchNo)[0] || null;

  return {
    tournament: tournament || null,
    ring,
    assignment,
    category: cat,
    hasDraw: true,
    currentMatch: targetMatch,
    nextBout,
    matches: enrichedMatches,
    clock: normalizeClock(ring),
    serverNow: Date.now(),
  };
}

export async function setActiveBout(ringId: string, matchId: string) {
  // Update ring's active match pointer
  await db
    .update(rings)
    .set({ currentMatchId: matchId })
    .where(eq(rings.id, ringId));

  // Set match to LIVE if it's not already confirmed
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId));

  if (match && match.status !== "CONFIRMED" && match.status !== "BYE") {
    await db
      .update(matches)
      .set({ status: "LIVE" })
      .where(eq(matches.id, matchId));
  }

  try {
    revalidatePath(`/moderator/ring/${ringId}/current`);
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {}

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
  await db
    .update(matches)
    .set({
      akaScore: state.akaScore ?? 0,
      aoScore: state.aoScore ?? 0,
      akaPenalties: state.akaPenalties ?? 0,
      aoPenalties: state.aoPenalties ?? 0,
      senshu: state.senshu ?? null,
      status: "LIVE",
    })
    .where(eq(matches.id, matchId));

  try {
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {}

  return { success: true };
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
  }
) {
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

  // 3. Commit match confirmation in transaction
  await db.transaction(async (tx) => {
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

    // Record match event
    await tx.insert(matchEvents).values({
      matchId,
      seq: 1,
      type: "RESULT_CONFIRMED",
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

    // 5. Update matchesCompleted on category_assignments to true confirmed count!
    const totalConfirmed = allMatches.filter(
      (m) => m.id === matchId || m.status === "CONFIRMED" || m.status === "BYE"
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
    }
  });

  return { success: true };
}

export async function getTournamentActiveBouts(tournamentId: string) {
  const tournamentRings = await db
    .select({ id: rings.id })
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId))
    .orderBy(rings.ringOrder);

  const results = await Promise.all(
    tournamentRings.map(async (r) => {
      const bout = await getRingActiveBout(r.id);
      return { ringId: r.id, bout };
    })
  );

  const boutMap: Record<string, any> = {};
  for (const item of results) {
    if (item.bout) {
      boutMap[item.ringId] = item.bout;
    }
  }
  return boutMap;
}
