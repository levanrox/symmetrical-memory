"use server";

import { db } from "@/db";
import {
  tournamentCategoryDefinitions,
  categories,
  tournaments,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { OFFICIAL_PRESETS, type CategoryDefinitionInput } from "@/lib/constants/categoryPresets";

export async function getTournamentCategoryDefinitions(tournamentId: string) {
  return await db
    .select()
    .from(tournamentCategoryDefinitions)
    .where(eq(tournamentCategoryDefinitions.tournamentId, tournamentId));
}

export async function saveCategoryDefinitions(
  tournamentId: string,
  defs: CategoryDefinitionInput[]
) {
  // Save or replace definitions
  await db.transaction(async (tx) => {
    // Delete existing definitions
    await tx
      .delete(tournamentCategoryDefinitions)
      .where(eq(tournamentCategoryDefinitions.tournamentId, tournamentId));

    if (defs.length > 0) {
      await tx.insert(tournamentCategoryDefinitions).values(
        defs.map((d) => ({
          tournamentId,
          categoryName: d.categoryName.trim(),
          eventType: d.eventType,
          gender: d.gender,
          minAge: d.minAge ?? null,
          maxAge: d.maxAge ?? null,
          minWeight: d.minWeight != null ? String(d.minWeight) : null,
          maxWeight: d.maxWeight != null ? String(d.maxWeight) : null,
          rules: d.rules ?? {},
        }))
      );
    }
  });

  // Automatically ensure operational categories exist in `categories` table
  await syncCategoriesFromDefinitions(tournamentId);

  try {
    revalidatePath(`/admin/event/${tournamentId}/categories`);
  } catch {}
  return { success: true, count: defs.length };
}

export async function loadPresetCategoryDefinitions(
  tournamentId: string,
  presetKey: string
) {
  const preset = OFFICIAL_PRESETS[presetKey];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetKey}`);
  }
  return await saveCategoryDefinitions(tournamentId, preset);
}

/**
 * Ensures a matching row in public.categories exists for each category definition
 */
export async function syncCategoriesFromDefinitions(tournamentId: string) {
  const defs = await db
    .select()
    .from(tournamentCategoryDefinitions)
    .where(eq(tournamentCategoryDefinitions.tournamentId, tournamentId));

  const existingCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  const existingMap = new Map(
    existingCats.map((c) => [c.name.toLowerCase().trim(), c])
  );

  for (const def of defs) {
    const norm = def.categoryName.toLowerCase().trim();
    if (!existingMap.has(norm)) {
      await db.insert(categories).values({
        tournamentId,
        name: def.categoryName,
        ageBracket: def.minAge && def.maxAge ? `${def.minAge}-${def.maxAge}` : null,
        weightClass:
          def.minWeight && def.maxWeight
            ? `${def.minWeight}-${def.maxWeight} kg`
            : null,
        sex: def.gender === "any" ? null : def.gender,
        ageMin: def.minAge,
        ageMax: def.maxAge,
        athletesCount: 0,
        expectedMatches: 0,
        hasFullRoster: false,
      });
    }
  }
}
