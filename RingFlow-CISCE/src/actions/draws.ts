"use server";

import { db } from "@/db";
import {
  athletes,
  categories,
  categoryEntries,
  draws,
  drawVersions,
  matches,
  matchEvents,
  matchSlots,
} from "@/db/schema";
import { generateDraw, resolveDraw } from "@/engine/draw-engine";
import type { DrawGraph, Participant } from "@/engine/draw-engine/types";
import { getRuleset, WKF_KATA_2026, WKF_KUMITE_2026 } from "@/engine/rules-engine";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { moderatorRequests, tournaments } from "@/db/schema";
import { ensureAdmin } from "./admin";
import { ensureOrganiser } from "./organiser";

/**
 * Staff (moderator, organiser, admin) may always open a full bracket. The
 * public may only open one when the admin enabled public draws — or when they
 * reached it through their own athlete's search result, which is scoped to a
 * single name they already know.
 */
async function isStaffViewer(): Promise<boolean> {
  const cookieStore = await cookies();

  if (cookieStore.get("admin_session")?.value || cookieStore.get("admin_dev_id")?.value) {
    try {
      await ensureAdmin();
      return true;
    } catch {}
  }

  if (cookieStore.get("org_token")?.value) {
    try {
      await ensureOrganiser();
      return true;
    } catch {}
  }

  const modToken = cookieStore.get("mod_token")?.value;
  if (modToken) {
    const [approved] = await db
      .select({ id: moderatorRequests.id })
      .from(moderatorRequests)
      .where(
        and(
          eq(moderatorRequests.sessionToken, modToken),
          eq(moderatorRequests.status, "approved")
        )
      )
      .limit(1);
    if (approved) return true;
  }

  return false;
}

async function publicDrawsEnabledForCategory(categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ showPublicDraws: tournaments.showPublicDraws })
    .from(categories)
    .innerJoin(tournaments, eq(tournaments.id, categories.tournamentId))
    .where(eq(categories.id, categoryId));

  return row?.showPublicDraws !== false;
}

export interface BracketSlotView {
  position: number;
  registrationId: string | null;
  sourceMatchId: string | null;
}

export interface BracketMatchView {
  matchId: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: string;
  status: string;
  slots?: BracketSlotView[];
  aka: { displayName: string; school?: string; id?: string };
  ao: { displayName: string; school?: string; id?: string };
  winnerId?: string | null;
  state?: {
    points?: { aka: number; ao: number };
    winner?: { side: string; method: string };
  } | null;
}

export async function generateCategoryDraw(
  categoryId: string,
  options?: { bronzeMedals?: 1 | 2; separateByClub?: boolean }
) {
  // 1. Fetch category
  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

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
        bronzeMedals: options?.bronzeMedals ?? 2,
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

    return { drawId, matchCount: graph.matches.length, version };
  });

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}
  return { success: true, ...result };
}

/**
 * Bulk generate draws for all categories in a tournament in one go!
 */
export async function generateAllTournamentDraws(
  tournamentId: string,
  options?: { bronzeMedals?: 1 | 2; separateByClub?: boolean }
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
      const res = await generateCategoryDraw(cat.id, options);
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

/**
 * Fetches and resolves the full digital draw tree for a category with live match states and athlete names
 */
export async function getCategoryDraw(
  categoryId: string,
  options?: { athleteId?: string | null }
) {
  if (!categoryId) return null;

  const staff = await isStaffViewer();
  if (!staff) {
    const allowed = options?.athleteId ? true : await publicDrawsEnabledForCategory(categoryId);
    if (!allowed) {
      return {
        locked: true,
        draw: null,
        categoryName: null,
        matches: [] as BracketMatchView[],
        podium: [],
        highlightAthleteId: null as string | null,
      };
    }
  }

  const [category] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId));

  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  if (!draw) return null;

  const [latestVersion] = await db
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);

  if (!latestVersion) return null;

  const graph = latestVersion.graph as unknown as DrawGraph;

  // Fetch all db matches, slots, and events to resolve current state
  const dbMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.categoryId, categoryId));

  const dbSlots = await db
    .select()
    .from(matchSlots)
    .where(
      inArray(
        matchSlots.matchId,
        dbMatches.map((m) => m.id)
      )
    );

  // Fetch all athletes in this tournament for name mapping
  const athleteList = await db.select().from(athletes);
  const athleteMap = new Map(athleteList.map((a) => [a.id, a]));

  // Map outcomes if matches were completed
  const outcomes = new Map<string, { kind: 'WINNER'; side: 'AKA' | 'AO' }>();
  for (const m of dbMatches) {
    if (m.winnerId) {
      let side: 'AKA' | 'AO' = (m.winnerSide as 'AKA' | 'AO') || 'AKA';
      if (!m.winnerSide) {
        const matchSlotsList = dbSlots.filter((s) => s.matchId === m.id);
        const aka = matchSlotsList.find((s) => s.position === 1);
        side = m.winnerId === aka?.athleteId ? 'AKA' : 'AO';
      }
      outcomes.set(m.id, {
        kind: 'WINNER',
        side,
      });
    }
  }

  const resolved = resolveDraw(graph, outcomes);
  const resolvedMatchMap = new Map(resolved.matches.map((rm) => [rm.matchId, rm]));

  // Build client-ready BracketMatch array
  const matchesMap: Record<string, BracketMatchView> = {};

  for (const m of graph.matches) {
    const resolvedMatch = resolvedMatchMap.get(m.id);
    const slotsForMatch = dbSlots
      .filter((s) => s.matchId === m.id)
      .map((s) => ({
        position: s.position,
        registrationId: s.athleteId,
        sourceMatchId: s.sourceMatchId,
      }));

    const akaRegId = resolvedMatch?.slots[0]?.registrationId;
    const aoRegId = resolvedMatch?.slots[1]?.registrationId;

    const akaAthlete = akaRegId ? athleteMap.get(akaRegId) : null;
    const aoAthlete = aoRegId ? athleteMap.get(aoRegId) : null;

    matchesMap[m.id] = {
      matchId: m.id,
      matchNo: m.matchNo,
      roundNo: m.roundNo,
      roundName: m.roundName,
      bracketType: m.bracketType,
      status: resolvedMatch?.status ?? "SCHEDULED",
      slots: slotsForMatch,
      aka: {
        id: akaAthlete?.id,
        displayName: akaAthlete?.name ?? "TBD",
        school: akaAthlete?.school || akaAthlete?.dojo || undefined,
      },
      ao: {
        id: aoAthlete?.id,
        displayName: aoAthlete?.name ?? "TBD",
        school: aoAthlete?.school || aoAthlete?.dojo || undefined,
      },
      winnerId: resolvedMatch?.winnerRegistrationId ?? null,
      state: resolvedMatch?.winnerRegistrationId
        ? {
            winner: {
              side: resolvedMatch.winnerRegistrationId === akaRegId ? 'AKA' : 'AO',
              method: 'CONFIRMED',
            },
          }
        : null,
    };
  }

  return {
    locked: false,
    draw,
    categoryName: category?.name ?? graph.categoryId,
    matches: Object.values(matchesMap),
    podium: resolved.podium,
    highlightAthleteId: options?.athleteId ?? null,
  };
}

/**
 * The draw as one athlete's family sees it: the same bracket, with that
 * athlete highlighted and everyone else dimmed. Available to the public even
 * when general draw viewing is switched off, because it only reveals a name
 * the searcher already typed.
 */
export async function getAthleteDraw(athleteId: string) {
  if (!athleteId) return null;

  const [athlete] = await db
    .select({ id: athletes.id, name: athletes.name, categoryId: athletes.categoryId })
    .from(athletes)
    .where(eq(athletes.id, athleteId));

  if (!athlete?.categoryId) return null;

  const draw = await getCategoryDraw(athlete.categoryId, { athleteId });
  if (!draw) return null;

  return { ...draw, athleteName: athlete.name, highlightAthleteId: athleteId };
}

export async function lockCategoryDraw(categoryId: string) {
  await db
    .update(draws)
    .set({ state: "LOCKED", lockedAt: new Date() })
    .where(eq(draws.categoryId, categoryId));

  return { success: true };
}
