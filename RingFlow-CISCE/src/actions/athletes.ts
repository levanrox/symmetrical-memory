"use server";

import { db } from "@/db";
import { athletes, categories } from "@/db/schema";
import { eq, and, sql, or, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ensureAdminOwnsTournament } from "./admin";

export type AthleteInput = {
  name: string;
  chest_number: string;
  category_id?: string | null;
  school?: string | null;
  school_code?: string | null;
  sports_id?: string | null;
  sex?: string | null;
  age?: string | null;
  belt?: string | null;
  weight?: string | number | null;
};

export async function addAthlete(tournamentId: string, input: AthleteInput) {
  await ensureAdminOwnsTournament(tournamentId);

  const name = (input.name || "").trim().slice(0, 200);
  if (!name) throw new Error("Athlete name is required");

  const chestNumber = (input.chest_number || "").trim().slice(0, 50);

  let targetCategoryId: string | null = null;

  if (input.category_id && input.category_id !== "uncategorized" && input.category_id !== "auto") {
    // Explicit category selection
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

    if (cat) {
      targetCategoryId = cat.id;
    }
  } else if (input.category_id === "auto" || !input.category_id) {
    // Auto-assignment attempt if sex / age / belt provided
    const existingCats = await db
      .select()
      .from(categories)
      .where(eq(categories.tournamentId, tournamentId));

    const athleteAge = parseInt(input.age || "0", 10) || 0;
    const aSex = (input.sex || "").trim().toLowerCase();
    const aBelt = (input.belt || "").trim().toLowerCase();

    const matchedCat = existingCats.find((c) => {
      const cBelt = c.belt ? c.belt.trim().toLowerCase() : null;
      const cSex = c.sex ? c.sex.trim().toLowerCase() : null;

      if (cSex && aSex && cSex !== aSex) return false;
      if (cBelt && aBelt && cBelt !== aBelt) return false;
      if (c.ageMin !== null && athleteAge < c.ageMin) return false;
      if (c.ageMax !== null && athleteAge > c.ageMax) return false;
      return true;
    });

    if (matchedCat) {
      targetCategoryId = matchedCat.id;
    }
  }

  await db.insert(athletes).values({
    categoryId: targetCategoryId,
    tournamentId,
    name,
    chestNumber: chestNumber || null,
    school: input.school?.trim().slice(0, 200) || null,
    schoolCode: input.school_code?.trim().slice(0, 50) || null,
    sportsId: input.sports_id?.trim().slice(0, 50) || null,
    sex: input.sex?.trim().slice(0, 20) || null,
    age: input.age ? String(input.age).trim().slice(0, 20) : null,
    belt: input.belt?.trim().slice(0, 50) || null,
    weight: input.weight ? String(input.weight).trim().slice(0, 20) : null,
    dojo: input.school?.trim().slice(0, 200) || null,
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

export async function searchTournamentAthletes(
  tournamentId: string,
  query: string,
  categoryIds?: string[]
) {
  const cleanQ = query.trim().replace(/^#/, "");
  if (!cleanQ && (!categoryIds || categoryIds.length === 0)) return [];

  const words = cleanQ.split(/[\s\u00A0\u2000-\u200B]+/).filter(Boolean);
  const pattern = words.length > 0 ? `%${words.join("%")}%` : "";

  const whereConditions = [eq(athletes.tournamentId, tournamentId)];

  const textMatches = [];
  if (pattern) {
    textMatches.push(sql`LOWER(${athletes.name}) LIKE LOWER(${pattern})`);
    textMatches.push(sql`LOWER(COALESCE(${athletes.chestNumber}, '')) LIKE LOWER(${pattern})`);
  }
  if (categoryIds && categoryIds.length > 0) {
    textMatches.push(inArray(athletes.categoryId, categoryIds.slice(0, 50)));
  }

  if (textMatches.length > 0) {
    whereConditions.push(or(...textMatches)!);
  }

  const results = await db
    .select({
      id: athletes.id,
      name: athletes.name,
      chestNumber: athletes.chestNumber,
      categoryId: athletes.categoryId,
      categoryName: categories.name,
      categoryDocUrl: categories.docUrl,
    })
    .from(athletes)
    .leftJoin(categories, eq(athletes.categoryId, categories.id))
    .where(and(...whereConditions))
    .limit(30);

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    chest_number: r.chestNumber,
    chestNumber: r.chestNumber,
    category_id: r.categoryId,
    categories: r.categoryId ? { id: r.categoryId, name: r.categoryName, doc_url: r.categoryDocUrl } : null,
  }));
}

