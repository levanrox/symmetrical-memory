/**
 * Recalculates `categories.expected_matches` for every category that already has
 * a draw, so the existing event matches the new rule: the bout count is the
 * number of matches someone actually has to run (byes and empty matches do not
 * count). Categories without a draw keep the athletes-minus-one estimate.
 *
 * Idempotent — run it whenever you like.
 *
 * Run:  NODE_ENV=development npx tsx scripts/backfill-expected-matches.ts
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

import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { categories, draws, drawVersions } from "../src/db/schema";
import { foughtBoutCount } from "../src/lib/draws/boutCount";
import type { DrawGraph } from "../src/engine/draw-engine/types";

async function main() {
  const rows = await db
    .select({
      categoryId: draws.categoryId,
      version: draws.version,
      categoryName: categories.name,
      expectedMatches: categories.expectedMatches,
    })
    .from(draws)
    .innerJoin(categories, eq(categories.id, draws.categoryId));

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const [snapshot] = await db
      .select({ graph: drawVersions.graph })
      .from(drawVersions)
      .where(eq(drawVersions.drawId, (await db
        .select({ id: draws.id })
        .from(draws)
        .where(eq(draws.categoryId, row.categoryId))
        .limit(1))[0]?.id ?? ""))
      .limit(1);

    if (!snapshot?.graph) {
      console.log(`  skip  ${row.categoryName} — no stored draw graph`);
      skipped += 1;
      continue;
    }

    const fought = foughtBoutCount(snapshot.graph as DrawGraph);

    if (fought === row.expectedMatches) {
      continue;
    }

    await db
      .update(categories)
      .set({ expectedMatches: fought })
      .where(eq(categories.id, row.categoryId));

    console.log(`  set   ${row.categoryName}: ${row.expectedMatches} → ${fought}`);
    updated += 1;
  }

  console.log("");
  console.log(`${rows.length} drawn categories · ${updated} updated · ${skipped} skipped`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
