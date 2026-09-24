/**
 * E2E verification: kata GROUPS_THEN_ELIMINATION draw → assembleCategoryDraw
 * returns a kataDraw table view with every participant named (no TBD tree).
 * Run with: DATABASE_URL=... npx tsx scripts/verify-kata-table-view.ts
 */
import { db } from "../src/db/index";
import {
  admins,
  athletes,
  categories,
  tournaments,
} from "../src/db/schema/index";
import { performCategoryDraw } from "../src/lib/draws/generateDraws";
import { assembleCategoryDraw } from "../src/lib/draws/assembleDraw";
import { eq } from "drizzle-orm";

async function main() {
  console.log("starting…");
  const tag = `e2e-${Date.now()}`;
  const [admin] = await db
    .insert(admins)
    .values({ id: crypto.randomUUID(), email: `${tag}@test.dev`, name: "E2E" })
    .returning();
  const [tournament] = await db
    .insert(tournaments)
    .values({ adminId: admin!.id, name: `E2E Kata Tables ${tag}` })
    .returning();
  const [category] = await db
    .insert(categories)
    .values({
      tournamentId: tournament!.id,
      name: "Boys Kata U14",
      kataFormat: "GROUPS_THEN_ELIMINATION",
    })
    .returning();

  const names = [
    "Aarav Sharma",
    "Bina Patel",
    "Chetan Rao",
    "Divya Nair",
    "Eshan Verma",
    "Farah Khan",
    "Gopal Iyer",
    "Hina Bose",
  ];
  for (let i = 0; i < names.length; i++) {
    await db.insert(athletes).values({
      tournamentId: tournament!.id,
      categoryId: category!.id,
      name: names[i]!,
      chestNumber: String(101 + i),
      school: `Dojo ${(i % 3) + 1}`,
    });
  }

  const drawRes = await performCategoryDraw(category!.id);
  if (!drawRes.success) throw new Error(`draw failed: ${drawRes.error}`);
  console.log(`draw ok: format=${drawRes.kataFormat} groups=${drawRes.groupCount} matches=${drawRes.matchCount}`);

  const assembled: any = await assembleCategoryDraw(category!.id);
  const kataDraw = assembled.kataDraw;
  if (!kataDraw) throw new Error("FAIL: kataDraw missing — UI would show the tree");

  const failures: string[] = [];
  for (const g of kataDraw.groups) {
    if (g.members.length === 0) failures.push(`${g.name}: no members`);
    for (const m of g.members) {
      if (!m.name || m.name === "Unknown athlete") failures.push(`${g.name}: unnamed member ${m.id}`);
      if (m.rank == null) failures.push(`${g.name}/${m.name}: no rank`);
    }
  }
  const qCount = kataDraw.groups.flatMap((g: any) => g.members).filter((m: any) => m.qualified).length;
  console.log(
    `groups=${kataDraw.groups.length} members=${kataDraw.groups.map((g: any) => g.members.length).join(",")} qualified=${qCount}`
  );
  console.log(
    `sample: ${kataDraw.groups[0]?.name} → ` +
      kataDraw.groups[0]?.members.slice(0, 3).map((m: any) => `${m.name}(#${m.chestNumber},rank ${m.rank}${m.qualified ? ",Q" : ""})`).join(" | ")
  );

  // Cleanup
  await db.delete(tournaments).where(eq(tournaments.id, tournament!.id));
  await db.delete(admins).where(eq(admins.id, admin!.id));

  if (failures.length) {
    console.error("FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("PASS: kataDraw table view has named participants, ranks, and qualifiers");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
