/**
 * Post-confirmation bracket advancement (shared).
 *
 * Moved out of `confirmBoutResult` (src/actions/matches.ts) so the kata
 * confirm path (src/actions/judge.ts) can advance single-elimination kata
 * brackets through the same draw-engine logic. Behaviour is identical for
 * the kumite path: resolve the stored draw graph with ALL confirmed
 * outcomes, fill dependent slots, flip READY statuses, bump
 * `matchesCompleted`, clear the ring's active-bout pointer, and broadcast.
 *
 * MUST be called inside the caller's transaction: the caller holds the
 * match-row lock and this function performs the dependent writes atomically
 * with the confirmation.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categoryAssignments,
  matches,
  matchSlots,
  rings,
} from "@/db/schema";
import { resolveDraw } from "@/engine/draw-engine";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { broadcastLiveEvent } from "@/lib/realtime/bus";

/** The drizzle transaction handle type (inferred — avoids a brittle import). */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BracketAdvanceInput {
  categoryId: string;
  matchId: string;
  winnerId: string;
  winningSide: "AKA" | "AO";
  /**
   * The stored draw graph. Null when there is no bracket to advance through:
   * the slot/status resolution is skipped but the assignment bookkeeping
   * (matchesCompleted, active-bout reset, broadcasts) still runs. Used for
   * kata group-stage bouts, whose "advancement" is the group follow-up
   * (standings + elimination fill-in) instead of draw-engine resolution.
   */
  graph: DrawGraph | null;
}

export async function advanceBracketAfterConfirm(
  tx: Transaction,
  input: BracketAdvanceInput
): Promise<void> {
  const { categoryId, matchId, winnerId, winningSide, graph } = input;

  // matchesCompleted counts bouts actually fought, so it lines up with the
  // expected_matches the draw wrote (which excludes byes/walkovers). Read
  // before any status flips below so the just-confirmed bout is included.
  const preMatches = await tx
    .select({ id: matches.id, status: matches.status })
    .from(matches)
    .where(eq(matches.categoryId, categoryId));
  const totalConfirmed = preMatches.filter(
    (m) => (m.id === matchId || m.status === "CONFIRMED") && m.status !== "BYE"
  ).length;

  if (graph) {
    // Resolve the graph with ALL confirmed outcomes (the just-confirmed
    // bout included, so its winner propagates even though the row write
    // above may not be visible to a fresh read inside some poolers).
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
  }

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
}
