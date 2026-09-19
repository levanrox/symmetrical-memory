import { db } from "@/db";
import {
  athletes,
  categories,
  categoryEntries,
  draws,
  drawVersions,
  matches,
  matchSlots,
  tournaments,
} from "@/db/schema";
import { generateDraw } from "@/engine/draw-engine";
import type { DrawGraph, Participant } from "@/engine/draw-engine/types";
import { foughtBoutCount } from "@/lib/draws/boutCount";
import { WKF_KATA_2026, WKF_KUMITE_2026 } from "@/engine/rules-engine";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * The unimplemented-by-design core of draw generation: pure database work with
 * no request context, so the admin actions can guard it and scripts (seeding,
 * verification) can call it directly. Never expose these to the client.
 */
export async function performCategoryDraw(
  categoryId: string,
  options?: { bronzeMedals?: 0 | 1 | 2; separateByClub?: boolean }
) {
  // 1. Fetch category
  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  // The bronze choice resolves in order: explicit override → this category's
  // setting → the tournament default → WKF's two.
  const [tournament] = await db
    .select({ defaultBronzeMedals: tournaments.defaultBronzeMedals })
    .from(tournaments)
    .where(eq(tournaments.id, cat.tournamentId));

  const bronzeMedals: 0 | 1 | 2 =
    options?.bronzeMedals ??
    (cat.bronzeMedals === 0 || cat.bronzeMedals === 1 || cat.bronzeMedals === 2
      ? (cat.bronzeMedals as 0 | 1 | 2)
      : undefined) ??
    (tournament?.defaultBronzeMedals === 0 ||
    tournament?.defaultBronzeMedals === 1 ||
    tournament?.defaultBronzeMedals === 2
      ? (tournament.defaultBronzeMedals as 0 | 1 | 2)
      : 2);

  // 2. Fetch category entries with athlete details
  const entries = await db
    .select({
      entryId: categoryEntries.id,
      athleteId: athletes.id,
      name: athletes.name,
      school: athletes.school,
      dojo: athletes.dojo,
      seed: categoryEntries.seed,
    })
    .from(categoryEntries)
    .innerJoin(athletes, eq(categoryEntries.athleteId, athletes.id))
    .where(eq(categoryEntries.categoryId, categoryId));

  // Fallback: if category_entries is empty, check legacy athletes.category_id
  let participantList = entries;
  if (participantList.length === 0) {
    const legacyAthletes = await db
      .select({
        entryId: athletes.id,
        athleteId: athletes.id,
        name: athletes.name,
        school: athletes.school,
        dojo: athletes.dojo,
        seed: sql<number | null>`null`,
      })
      .from(athletes)
      .where(eq(athletes.categoryId, categoryId));
    participantList = legacyAthletes;
  }

  if (participantList.length < 2) {
    return {
      success: false,
      error: `Category "${cat.name}" has ${participantList.length} competitor(s). Minimum 2 competitors required to generate a bracket.`,
    };
  }

  // 3. Build participants array
  const participants: Participant[] = participantList.map((p) => ({
    registrationId: p.athleteId,
    displayName: p.name,
    clubId: p.school || p.dojo || "Independent",
    districtId: null,
  }));

  // 4. Select ruleset
  const isKata = cat.name.toLowerCase().includes("kata");
  const ruleset = isKata ? WKF_KATA_2026 : WKF_KUMITE_2026;

  // 5. Run draw engine
  const graph: DrawGraph = generateDraw(
    {
      categoryId,
      format: "SINGLE_ELIM_REPECHAGE",
      participants,
      seeding: {
        mode: "RANDOM_SEEDED",
        randomSeed: Date.now(),
      },
      separation: {
        by: "CLUB",
        rule: "FIRST_ROUND",
      },
      options: {
        bronzeMedals,
      },
    },
    ruleset
  );

  // 6. Save draw into database atomically
  const result = await db.transaction(async (tx) => {
    // Delete existing matches and slots (cascade deletes slots)
    await tx.delete(matches).where(eq(matches.categoryId, categoryId));

    // Upsert draw record
    const [existingDraw] = await tx
      .select()
      .from(draws)
      .where(eq(draws.categoryId, categoryId));

    const version = existingDraw ? existingDraw.version + 1 : 1;
    const drawId = existingDraw?.id ?? crypto.randomUUID();

    if (existingDraw) {
      await tx
        .update(draws)
        .set({
          version,
          format: graph.format,
          rulesetId: graph.rulesetId,
          tournamentSize: graph.tournamentSize,
          byeCount: graph.byeCount,
          checksum: graph.checksum,
          state: "DRAFT",
          bronzeMedals,
        })
        .where(eq(draws.id, drawId));
    } else {
      await tx.insert(draws).values({
        id: drawId,
        categoryId,
        version,
        format: graph.format,
        rulesetId: graph.rulesetId,
        tournamentSize: graph.tournamentSize,
        byeCount: graph.byeCount,
        checksum: graph.checksum,
        state: "DRAFT",
        bronzeMedals,
      });
    }

    // Insert version history snapshot
    await tx.insert(drawVersions).values({
      drawId,
      version,
      graph: graph as any,
      checksum: graph.checksum,
      reason: "Generated by organizer",
    });

    // Insert exploded matches
    if (graph.matches.length > 0) {
      await tx.insert(matches).values(
        graph.matches.map((m) => ({
          id: m.id,
          categoryId,
          matchNo: m.matchNo,
          roundNo: m.roundNo,
          roundName: m.roundName,
          bracketType: m.bracketType,
          status: "SCHEDULED",
        }))
      );
    }

    // Insert match slots
    if (graph.slots.length > 0) {
      await tx.insert(matchSlots).values(
        graph.slots.map((s) => ({
          id: s.id,
          matchId: s.matchId,
          position: s.position,
          slotType: s.slotType,
          athleteId: s.registrationId ?? null,
          sourceMatchId: s.sourceMatchId ?? null,
        }))
      );
    }

    // The category's bout count is now a fact rather than the athletes-minus-one
    // estimate: every progress bar reads "Match X of Y" straight from this
    // column. `foughtBoutCount` excludes byes and empty matches, so 100% stays
    // reachable once every real bout is confirmed.
    const foughtBouts = foughtBoutCount(graph);

    await tx
      .update(categories)
      .set({ expectedMatches: foughtBouts })
      .where(eq(categories.id, categoryId));

    return { drawId, matchCount: graph.matches.length, foughtBouts, version };
  });

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}
  return { success: true, ...result };
}

export async function performGenerateAllTournamentDraws(
  tournamentId: string,
  options?: { bronzeMedals?: 0 | 1 | 2; separateByClub?: boolean }
) {
  const allCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  let generatedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const cat of allCats) {
    try {
      const res = await performCategoryDraw(cat.id, options);
      if (res.success) {
        generatedCount++;
      } else {
        skippedCount++;
        if (res.error) errors.push(res.error);
      }
    } catch (err: any) {
      skippedCount++;
      errors.push(`Category "${cat.name}": ${err.message}`);
    }
  }

  try {
    revalidatePath(`/admin/event/${tournamentId}/categories`);
  } catch {}
  return {
    success: true,
    totalCategories: allCats.length,
    generatedCount,
    skippedCount,
    errors,
  };
}
