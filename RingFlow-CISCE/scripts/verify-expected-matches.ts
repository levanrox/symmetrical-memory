/**
 * Proves the bout count is a fact rather than an estimate:
 *  1. generating a draw writes `expected_matches` = matches minus byes/empties
 *  2. every already-drawn category in the database agrees with its stored graph
 *  3. a repechage category counts more bouts than athletes-minus-one (the whole
 *     point: the old estimate ignored repechage and bronze bouts)
 *
 * Run:  NODE_ENV=development npx tsx scripts/verify-expected-matches.ts
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No .env.local: the defaults in src/db/index.ts apply.
}

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { categories, categoryEntries, draws, drawVersions, tournaments } from "../src/db/schema";
import type { DrawGraph } from "../src/engine/draw-engine/types";
import { performCategoryDraw } from "../src/lib/draws/generateDraws";
import { foughtBoutCount } from "../src/lib/draws/boutCount";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("═══ generated draw ═══");

  const [tournament] = await db.select().from(tournaments).limit(1);
  if (!tournament) {
    console.log("No tournaments in the database; nothing to check.");
    process.exit(1);
  }

  // A 17-entrant category: 15 byes in a 32-draw, plus repechage and two bronzes.
  const entrants = 17;
  const scratchName = `ZZ VERIFY BOUTS ${Date.now()}`;

  // Borrow real athletes — the draw needs entries, and a category with none
  // simply refuses to generate. Distinct, because the same athlete is entered
  // in several categories.
  const donorEntries = await db
    .selectDistinct({ athleteId: categoryEntries.athleteId })
    .from(categoryEntries)
    .limit(entrants);

  if (donorEntries.length < entrants) {
    console.log(`Only ${donorEntries.length} entries available; need ${entrants}.`);
    process.exit(1);
  }

  const [scratch] = await db
    .insert(categories)
    .values({
      tournamentId: tournament.id,
      name: scratchName,
      athletesCount: entrants,
      expectedMatches: entrants - 1,
    })
    .returning();

  await db.insert(categoryEntries).values(
    donorEntries.map((entry) => ({
      categoryId: scratch.id,
      athleteId: entry.athleteId,
    }))
  );

  try {
    const result = await performCategoryDraw(scratch.id, { bronzeMedals: 2 });
    check("the draw generated", Boolean(result?.success), JSON.stringify(result));

    if (!result?.success || !("matchCount" in result)) {
      throw new Error(("error" in result && result.error) || "the draw did not generate");
    }

    const [after] = await db.select().from(categories).where(eq(categories.id, scratch.id)).limit(1);
    const totalMatches = result.matchCount;
    const byes = totalMatches - result.foughtBouts;

    check(
      "the category now counts the bouts that will be run",
      after.expectedMatches === result.foughtBouts,
      `${after.expectedMatches} vs ${result.foughtBouts}`
    );
    check("byes are excluded from the count", byes > 0, `${byes} byes of ${totalMatches} matches`);
    check(
      "a repechage category counts more bouts than athletes minus one",
      after.expectedMatches > entrants - 1,
      `${after.expectedMatches} bouts vs the old estimate ${entrants - 1}`
    );

    // The count must be reproducible from the stored graph alone (what the
    // backfill does), otherwise the two paths could drift.
    const [drawRow] = await db.select({ id: draws.id }).from(draws).where(eq(draws.categoryId, scratch.id)).limit(1);
    check("a draw row was written", Boolean(drawRow?.id));

    if (drawRow?.id) {
      const [snapshot] = await db
        .select({ graph: drawVersions.graph })
        .from(drawVersions)
        .where(eq(drawVersions.drawId, drawRow.id))
        .limit(1);

      check("a draw snapshot was stored", Boolean(snapshot?.graph));
      if (snapshot?.graph) {
        check(
          "the stored graph recounts to the same number",
          foughtBoutCount(snapshot.graph as DrawGraph) === after.expectedMatches,
          `${foughtBoutCount(snapshot.graph as DrawGraph)} vs ${after.expectedMatches}`
        );
      }
    }
  } finally {
    // Clean up: matches and slots cascade from the draw.
    await db.delete(draws).where(eq(draws.categoryId, scratch.id));
    await db.delete(categoryEntries).where(eq(categoryEntries.categoryId, scratch.id));
    await db.delete(categories).where(eq(categories.id, scratch.id));
    const [gone] = await db.select().from(categories).where(eq(categories.id, scratch.id));
    check("the scratch category was removed", !gone);
  }

  console.log("");
  console.log("═══ existing draws in the database ═══");

  const drawn = await db
    .select({ categoryId: draws.categoryId, drawId: draws.id, name: categories.name, expected: categories.expectedMatches })
    .from(draws)
    .innerJoin(categories, eq(categories.id, draws.categoryId));

  const mismatches: string[] = [];
  for (const row of drawn) {
    const [snapshot] = await db
      .select({ graph: drawVersions.graph })
      .from(drawVersions)
      .where(eq(drawVersions.drawId, row.drawId))
      .limit(1);
    if (!snapshot?.graph) continue;
    const fought = foughtBoutCount(snapshot.graph as DrawGraph);
    if (fought !== row.expected) mismatches.push(`${row.name}: stored ${row.expected}, graph says ${fought}`);
  }

  check(`${drawn.length} drawn categories agree with their stored graphs`, mismatches.length === 0, mismatches.slice(0, 5).join(" · "));
  check(
    "no category is left with zero expected bouts while holding a draw",
    (await db.select().from(categories).where(and(inArray(categories.id, drawn.map((d) => d.categoryId)), eq(categories.expectedMatches, 0)))).length === 0
  );

  console.log("");
  if (failures === 0) {
    console.log("All bout-count checks passed.");
  } else {
    console.log(`${failures} bout-count check(s) failed.`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Bout-count verification crashed:", err);
  process.exit(1);
});
