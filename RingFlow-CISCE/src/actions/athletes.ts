"use server";

import { db } from "@/db";
import { athletes, categories } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ensureAdminOwnsTournament } from "./admin";

export type AthleteInput = {
  name: string;
  chest_number: string;
  category_id: string;
  school?: string | null;
  school_code?: string | null;
  sports_id?: string | null;
};

export async function addAthlete(tournamentId: string, input: AthleteInput) {
  await ensureAdminOwnsTournament(tournamentId);

  // Verify category belongs to tournament
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, input.category_id),
        eq(categories.tournamentId, tournamentId)
      )
    )
    .limit(1);

  if (!cat) throw new Error("Invalid category for this tournament");

  const name = (input.name || "").trim().slice(0, 200);
  if (!name) throw new Error("Athlete name is required");

  const chestNumber = (input.chest_number || "").trim().slice(0, 50);

  await db.insert(athletes).values({
    categoryId: input.category_id,
    tournamentId,
    name,
    chestNumber: chestNumber || null,
    school: input.school?.trim().slice(0, 200) || null,
    schoolCode: input.school_code?.trim().slice(0, 50) || null,
    sportsId: input.sports_id?.trim().slice(0, 50) || null,
  });

  revalidatePath(`/admin/event/${tournamentId}/athletes`);
}

export async function deleteAthlete(athleteId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db
    .delete(athletes)
    .where(
      and(eq(athletes.id, athleteId), eq(athletes.tournamentId, tournamentId))
    );

  revalidatePath(`/admin/event/${tournamentId}/athletes`);
}

export async function updateAthleteCategory(
  athleteId: string,
  categoryId: string | null,
  tournamentId: string
) {
  await ensureAdminOwnsTournament(tournamentId);

  if (categoryId) {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, categoryId),
          eq(categories.tournamentId, tournamentId)
        )
      )
      .limit(1);

    if (!cat) throw new Error("Target category not found in this tournament");
  }

  await db
    .update(athletes)
    .set({ categoryId })
    .where(
      and(eq(athletes.id, athleteId), eq(athletes.tournamentId, tournamentId))
    );

  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/rings/balance`);
}

export async function bulkAddAthletes(
  tournamentId: string,
  categoryName: string,
  rawAthletes: { no: string; name: string }[]
) {
  await ensureAdminOwnsTournament(tournamentId);

  // Find or create category
  const existingCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  let cat = existingCats.find(
    (c) => c.name.toLowerCase().trim() === categoryName.toLowerCase().trim()
  );

  if (!cat) {
    const expectedMatches = Math.max(0, rawAthletes.length - 1);
    const [newCat] = await db
      .insert(categories)
      .values({
        tournamentId,
        name: categoryName,
        athletesCount: rawAthletes.length,
        expectedMatches,
        hasFullRoster: true,
      })
      .returning();
    cat = newCat;
  } else {
    const newCount = (cat.athletesCount || 0) + rawAthletes.length;
    await db
      .update(categories)
      .set({
        athletesCount: newCount,
        expectedMatches: Math.max(0, newCount - 1),
      })
      .where(eq(categories.id, cat.id));
  }

  const categoryId = cat.id;

  const toInsert = rawAthletes.map((a) => ({
    categoryId,
    tournamentId,
    name: a.name,
    chestNumber: a.no ? String(a.no) : null,
  }));

  if (toInsert.length > 0) {
    await db.insert(athletes).values(toInsert);
  }

  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return { success: true, count: toInsert.length };
}

export async function bulkAddMasterAthletes(
  tournamentId: string,
  rawAthletes: any[]
) {
  await ensureAdminOwnsTournament(tournamentId);

  const existingCats = await db
    .select({
      id: categories.id,
      name: categories.name,
      belt: categories.belt,
      ageMin: categories.ageMin,
      ageMax: categories.ageMax,
      sex: categories.sex,
      day: categories.day,
    })
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  const catMap = new Map<string, string>();
  for (const c of existingCats) {
    catMap.set(c.name.toLowerCase().trim(), c.id);
  }

  const toInsert = rawAthletes.map((a) => {
    let matchedId: string | null = null;

    if (a.age && a.sex && a.category) {
      const constructedName = `${a.age.trim()}_${a.sex.trim()}_${a.category.trim()}`.toLowerCase();
      matchedId = catMap.get(constructedName) || null;
    }

    if (!matchedId && a.category_name) {
      matchedId = catMap.get(a.category_name.toLowerCase().trim()) || null;
    }
    if (!matchedId && a.category) {
      matchedId = catMap.get(a.category.toLowerCase().trim()) || null;
    }

    if (!matchedId && a.belt && a.sex) {
      const athleteAge = parseInt(a.age) || 0;
      const aBelt = a.belt.trim().toLowerCase();
      const aSex = a.sex.trim().toLowerCase();
      const aDay = a.day ? a.day.trim().toLowerCase() : null;

      const matchedCat = existingCats.find((c) => {
        const cBelt = c.belt ? c.belt.trim().toLowerCase() : null;
        const cSex = c.sex ? c.sex.trim().toLowerCase() : null;
        const cDay = c.day ? c.day.trim().toLowerCase() : null;

        return (
          cBelt === aBelt &&
          cSex === aSex &&
          (!cDay || cDay === aDay) &&
          (c.ageMin === null || athleteAge >= c.ageMin) &&
          (c.ageMax === null || athleteAge <= c.ageMax)
        );
      });
      if (matchedCat) {
        matchedId = matchedCat.id;
      }
    }

    return {
      categoryId: matchedId,
      tournamentId,
      name: a.name,
      chestNumber: a.no ? String(a.no) : null,
      belt: a.belt || null,
      age: a.age ? String(a.age) : null,
      sex: a.sex || null,
      school: a.school || a.dojo || null,
      schoolCode: a.school_code || null,
      sportsId: a.sports_id || null,
      day: a.day || null,
    };
  });

  if (toInsert.length > 0) {
    await db.insert(athletes).values(toInsert);
  }

  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  return { success: true, count: toInsert.length };
}
