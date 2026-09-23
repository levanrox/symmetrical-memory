import { db } from "@/db";
import {
  athletes,
  categories,
  categoryEntries,
  draws,
  drawVersions,
  matches,
  matchSlots,
  tournamentCategoryDefinitions,
  tournaments,
} from "@/db/schema";
import { generateDraw } from "@/engine/draw-engine";
import type { DrawGraph, Participant } from "@/engine/draw-engine/types";
import { foughtBoutCount } from "@/lib/draws/boutCount";
import {
  buildKataGroups,
  buildKataGroupsSnapshot,
  buildKataStageGraph,
  DEFAULT_KATA_ADVANCE_PER_GROUP,
  kataFoughtBoutCount,
  parseKataDrawFormat,
  parseKataRankingMethod,
  roundRobinBouts,
  type KataDrawFormat,
  type KataGroupsSnapshot,
  type KataParticipant,
  type KataRankingMethod,
} from "./kataDraws";
import { WKF_KATA_2026, WKF_KUMITE_2026 } from "@/engine/rules-engine";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Kata detection, P2.
 *
 * Prefers the explicit `event_type` on the tournament's category definitions —
 * matched by normalised category name, the same key the definition-sync
 * actions use — and falls back to the historical name-contains-"kata" check
 * when the category was created ad-hoc without a definition.
 */
export async function isKataCategory(category: {
  tournamentId: string;
  name: string;
}): Promise<boolean> {
  const defs = await db
    .select({
      categoryName: tournamentCategoryDefinitions.categoryName,
      eventType: tournamentCategoryDefinitions.eventType,
    })
    .from(tournamentCategoryDefinitions)
    .where(eq(tournamentCategoryDefinitions.tournamentId, category.tournamentId));

  const norm = category.name.toLowerCase().trim();
  const def = defs.find((d) => d.categoryName.toLowerCase().trim() === norm);
  if (def) return def.eventType === "kata" || def.eventType === "team_kata";
  return category.name.toLowerCase().includes("kata");
}

/** One row of the entrant list, from either the entries table or the legacy path. */
interface DrawParticipantRow {
  athleteId: string;
  name: string;
  school: string | null;
  dojo: string | null;
  seed: number | null;
}

export interface CategoryDrawSuccess {
  success: true;
  drawId: string;
  matchCount: number;
  foughtBouts: number;
  version: number;
  /** Only present on the kata group-format path (P2). */
  kataFormat?: KataDrawFormat;
  /** Only present on the kata group-format path (P2). */
  groupCount?: number;
}

export interface CategoryDrawFailure {
  success: false;
  error: string;
}

export type CategoryDrawResult = CategoryDrawSuccess | CategoryDrawFailure;

/**
 * The unimplemented-by-design core of draw generation: pure database work with
 * no request context, so the admin actions can guard it and scripts (seeding,
 * verification) can call it directly. Never expose these to the client.
 */
export async function performCategoryDraw(
  categoryId: string,
  options?: { bronzeMedals?: 0 | 1 | 2; separateByClub?: boolean }
): Promise<CategoryDrawResult> {
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
  let participantList: DrawParticipantRow[] = entries;
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
  const kata = await isKataCategory(cat);
  const ruleset = kata ? WKF_KATA_2026 : WKF_KUMITE_2026;

  // 4b. Kata group formats (P2) bypass the single-elimination engine: the
  // groups, round-robin bouts and (for GROUPS_THEN_ELIMINATION) the
  // placeholder elimination bracket are built by kataDraws and persisted by
  // the same persistDrawGraph below. Kumite and single-elimination kata keep
  // the existing path untouched.
  const kataFormat = parseKataDrawFormat(cat.kataFormat);
  if (kata && kataFormat !== "SINGLE_ELIM_REPECHAGE") {
    return performKataGroupDraw(categoryId, cat, participantList, {
      format: kataFormat,
      rankingMethod: parseKataRankingMethod(cat.kataRankingMethod),
      advancePerGroup: cat.kataAdvancePerGroup ?? DEFAULT_KATA_ADVANCE_PER_GROUP,
      groupSizeOverride: cat.kataGroupSize ?? null,
      bronzeMedals,
    });
  }

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
  const result = await persistDrawGraph({
    categoryId,
    tournamentId: cat.tournamentId,
    graph,
    bronzeMedals,
    kataGroups: null,
    foughtBouts: foughtBoutCount(graph),
  });

  return { success: true, ...result };
}

/**
 * The kata group-stage draw path (P2).
 *
 * Builds the groups (WKF 3.7.9 sizing, top-4 seeds distributed, seeded-random
 * fill), the round-robin bouts, and — for GROUPS_THEN_ELIMINATION — the
 * placeholder elimination bracket, then persists everything through the same
 * transactional writer as the elimination path.
 */
async function performKataGroupDraw(
  categoryId: string,
  cat: { tournamentId: string; name: string },
  participantList: DrawParticipantRow[],
  opts: {
    format: KataDrawFormat;
    rankingMethod: KataRankingMethod;
    advancePerGroup: number;
    groupSizeOverride: number | null;
    bronzeMedals: 0 | 1 | 2;
  }
): Promise<CategoryDrawSuccess> {
  const participants: KataParticipant[] = participantList.map((p) => ({
    registrationId: p.athleteId,
    displayName: p.name,
    clubId: p.school || p.dojo || "Independent",
    districtId: null,
    seed: p.seed ?? null,
  }));

  const randomSeed = Date.now();
  const groups = buildKataGroups(participants, {
    categoryId,
    groupSizeOverride: opts.groupSizeOverride,
    randomSeed,
  });
  const pairings = groups.flatMap(roundRobinBouts);
  const graph = buildKataStageGraph({
    categoryId,
    rulesetId: WKF_KATA_2026.id,
    format: opts.format,
    groups,
    pairings,
    advancePerGroup: opts.advancePerGroup,
    rankingMethod: opts.rankingMethod,
    randomSeed,
  });

  const snapshot = buildKataGroupsSnapshot({
    format: opts.format,
    rankingMethod: opts.rankingMethod,
    advancePerGroup: opts.advancePerGroup,
    randomSeed,
    groups,
  });

  const result = await persistDrawGraph({
    categoryId,
    tournamentId: cat.tournamentId,
    graph,
    bronzeMedals: opts.bronzeMedals,
    kataGroups: snapshot,
    foughtBouts: kataFoughtBoutCount(graph),
  });

  return {
    success: true,
    ...result,
    kataFormat: opts.format,
    groupCount: groups.length,
  };
}

/**
 * Transactional draw writer shared by both draw paths: replaces the
 * category's matches, upserts the draw row, snapshots the graph version, and
 * records the bout count the progress bars read.
 */
async function persistDrawGraph(args: {
  categoryId: string;
  tournamentId: string;
  graph: DrawGraph;
  bronzeMedals: 0 | 1 | 2;
  kataGroups: KataGroupsSnapshot | null;
  foughtBouts: number;
}) {
  const { categoryId, tournamentId, graph, bronzeMedals, kataGroups, foughtBouts } =
    args;

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
          kataGroups,
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
        kataGroups,
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

    // Insert exploded matches. Group-stage bouts carry their group id so the
    // ring queue and results views can filter/sort by group.
    if (graph.matches.length > 0) {
      await tx.insert(matches).values(
        graph.matches.map((m) => ({
          id: m.id,
          categoryId,
          matchNo: m.matchNo,
          roundNo: m.roundNo,
          roundName: m.roundName,
          bracketType: m.bracketType,
          groupId: m.poolId ?? null,
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
    // column. Byes and empty matches are excluded, so 100% stays reachable
    // once every real bout is confirmed.
    await tx
      .update(categories)
      .set({ expectedMatches: foughtBouts })
      .where(eq(categories.id, categoryId));

    return { drawId, matchCount: graph.matches.length, foughtBouts, version };
  });

  try {
    revalidatePath(`/admin/event/${tournamentId}/categories`);
  } catch {}
  return result;
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
