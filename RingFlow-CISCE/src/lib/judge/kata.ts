/**
 * Kata bout helpers (P3) — kata choice history for the repetition check.
 *
 * `getAthleteKataHistory` feeds P1's `validateKataRepetition`: the official
 * kata numbers an athlete has already performed in this tournament, in bout
 * order. Only decided bouts (COMPLETED/CONFIRMED) count as "past" — the bout
 * being set up is never decided yet, so it cannot pollute its own history.
 * The repetition *enforcement* UI is P5's job; this is the data helper.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categories, matches, matchSlots } from "@/db/schema";

export async function getAthleteKataHistory(
  tournamentId: string,
  athleteId: string
): Promise<number[]> {
  const rows = await db
    .select({
      position: matchSlots.position, // 1 = AKA, 2 = AO
      akaKata: matches.akaKataNumber,
      aoKata: matches.aoKataNumber,
      roundNo: matches.roundNo,
      matchNo: matches.matchNo,
    })
    .from(matchSlots)
    .innerJoin(matches, eq(matchSlots.matchId, matches.id))
    .innerJoin(categories, eq(matches.categoryId, categories.id))
    .where(
      and(
        eq(categories.tournamentId, tournamentId),
        eq(matchSlots.athleteId, athleteId),
        inArray(matches.status, ["COMPLETED", "CONFIRMED"])
      )
    )
    .orderBy(asc(matches.roundNo), asc(matches.matchNo));

  const history: number[] = [];
  for (const r of rows) {
    const kata = r.position === 1 ? r.akaKata : r.aoKata;
    if (kata != null) history.push(kata);
  }
  return history;
}

/**
 * Derive the `ageGroup` argument for `validateKataRepetition` from the
 * category's age bracket. Only 'U14' changes the limit (4 distinct kata
 * instead of 5); everything else is treated as senior.
 */
export function deriveAgeGroup(ageBracket: string | null | undefined): string {
  return (ageBracket ?? "").toLowerCase().includes("u14") ? "U14" : "senior";
}
