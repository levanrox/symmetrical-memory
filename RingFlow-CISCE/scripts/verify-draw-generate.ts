/**
 * Verifies draw generation end to end, against a throwaway category so no real
 * bracket is ever wiped:
 *
 *  1. the server-action modules evaluate (the "TournamentResults is not defined"
 *     crash happened while loading that module graph)
 *  2. the generation core builds a bracket, slots and a draw row
 *  3. the admin-only action refuses a caller with no session
 *
 * Run: npx tsx scripts/verify-draw-generate.ts
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { athletes, categories, categoryEntries, draws, matches, matchSlots, tournaments } from "../src/db/schema";
import { performCategoryDraw } from "../src/lib/draws/generateDraws";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\n── Server-action modules load ──────────────────────────────────");

  // Importing these is what used to throw: a type-only re-export inside a
  // "use server" file emitted a runtime reference to a name that does not exist,
  // which broke every screen importing the same action graph.
  const modules = await Promise.all([
    import("../src/actions/draws"),
    import("../src/actions/resultsExport"),
    import("../src/actions/drawPdfs"),
  ]).catch((err) => {
    check("action modules import", false, err?.message);
    return null;
  });

  if (!modules) {
    console.log(`\n${failures} draw-generation check(s) failed.\n`);
    process.exit(1);
  }

  const [drawsModule, resultsModule] = modules;
  check("actions/draws evaluates", true);
  check(
    "generateCategoryDraw / generateAllTournamentDraws are callable",
    typeof drawsModule.generateCategoryDraw === "function" &&
      typeof drawsModule.generateAllTournamentDraws === "function"
  );
  check("actions/resultsExport evaluates", true);
  check(
    "its exports are callable",
    typeof resultsModule.exportTournamentResultsCsv === "function" &&
      typeof resultsModule.exportTournamentResultsPdf === "function"
  );

  console.log("\n── Generating a throwaway bracket ──────────────────────────────");

  // Use the populated event so there are real athletes to enter.
  const roster = await db
    .select({ id: athletes.id, tournamentId: athletes.tournamentId, name: athletes.name })
    .from(athletes)
    .limit(400);

  const counts = new Map<string, typeof roster>();
  for (const athlete of roster) {
    if (!athlete.tournamentId) continue;
    const list = counts.get(athlete.tournamentId) ?? [];
    list.push(athlete);
    counts.set(athlete.tournamentId, list);
  }

  const [target] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!target || target[1].length < 5) {
    console.log("  SKIP  no event has enough athletes to build a bracket");
    process.exit(failures === 0 ? 0 : 1);
  }

  const [tournamentId, tournamentAthletes] = target;
  const [tournament] = await db
    .select({ name: tournaments.name })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));
  console.log(`  using "${tournament?.name}" (${tournamentAthletes.length} athletes)`);

  const [scratch] = await db
    .insert(categories)
    .values({
      tournamentId,
      name: `ZZ VERIFY DRAW ${Date.now()}`,
      ageBracket: "verify",
      weightClass: "verify",
      athletesCount: 5,
      expectedMatches: 4,
    })
    .returning({ id: categories.id, name: categories.name });

  let result: any = null;
  try {
    await db.insert(categoryEntries).values(
      tournamentAthletes.slice(0, 5).map((athlete) => ({
        categoryId: scratch.id,
        athleteId: athlete.id,
      }))
    );

    result = await performCategoryDraw(scratch.id);
    check("generation completes without throwing", true);
  } catch (err: any) {
    check("generation completes without throwing", false, err?.message);
  }

  check("generation reports success", Boolean(result?.success), JSON.stringify(result)?.slice(0, 200));

  const created = await db
    .select({ id: matches.id, roundNo: matches.roundNo, status: matches.status })
    .from(matches)
    .where(eq(matches.categoryId, scratch.id));

  check("the category has matches", created.length > 0, `${created.length} matches`);

  if (created.length > 0) {
    const slots = await db
      .select({ id: matchSlots.id, position: matchSlots.position })
      .from(matchSlots)
      .where(
        inArray(
          matchSlots.matchId,
          created.map((m) => m.id)
        )
      );

    check("every bout has both slots", slots.length === created.length * 2, `${slots.length} slots for ${created.length} bouts`);

    const rounds = new Set(created.map((m) => m.roundNo));
    check("the bracket spans more than one round", rounds.size > 1, `${rounds.size} rounds`);

    const [draw] = await db.select().from(draws).where(eq(draws.categoryId, scratch.id));
    check("a draw row is recorded", Boolean(draw), "no draws row");
    check(
      "it stores the bronze setting",
      typeof draw?.bronzeMedals === "number",
      `bronzeMedals=${draw?.bronzeMedals}`
    );
  }

  console.log("\n── The admin-only action refuses an anonymous caller ───────────");

  // ensureAdmin() falls back to the seeded director admin when NODE_ENV is not
  // production — a deliberate local-development affordance. The guard that
  // matters is the production one, so it is what gets asserted here.
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";

  let refused = false;
  let refusalMessage = "";
  try {
    const guarded = await drawsModule.generateCategoryDraw(scratch.id);
    refused = !guarded?.success && Boolean(guarded?.error);
    refusalMessage = JSON.stringify(guarded)?.slice(0, 120);
  } catch (err: any) {
    refused = true;
    refusalMessage = err?.message ?? "threw";
  }
  check("generateCategoryDraw is not callable without a session", refused, refusalMessage);

  // The same hole let anyone download any draw sheet PDF by calling the action.
  let pdfRefused = false;
  let pdfMessage = "";
  try {
    await modules[2].downloadCategoryDrawPdf(scratch.id);
    pdfRefused = false;
    pdfMessage = "returned a PDF";
  } catch (err: any) {
    pdfRefused = true;
    pdfMessage = err?.message ?? "threw";
  }
  check("downloadCategoryDrawPdf is not callable without a session", pdfRefused, pdfMessage);

  // Back to the ambient environment for the cleanup and anything after it.
  env.NODE_ENV = previousNodeEnv;

  // Clean up: deleting the category cascades to its entries, draw and matches.
  await db.delete(categories).where(eq(categories.id, scratch.id));

  const [leftoverMatches, leftoverDraws, leftoverEntries] = await Promise.all([
    db.select({ id: matches.id }).from(matches).where(eq(matches.categoryId, scratch.id)),
    db.select({ id: draws.id }).from(draws).where(eq(draws.categoryId, scratch.id)),
    db.select({ id: categoryEntries.id }).from(categoryEntries).where(eq(categoryEntries.categoryId, scratch.id)),
  ]);

  check(
    "deleting the category cleaned up its bracket",
    leftoverMatches.length === 0 && leftoverDraws.length === 0 && leftoverEntries.length === 0,
    `${leftoverMatches.length} matches / ${leftoverDraws.length} draws / ${leftoverEntries.length} entries left`
  );

  console.log(
    failures === 0 ? "\nAll draw-generation checks passed.\n" : `\n${failures} draw-generation check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-draw-generate crashed:", err);
  process.exit(1);
});
