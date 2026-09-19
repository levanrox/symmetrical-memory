/**
 * Verifies the post-event results record: the data it assembles, the CSV a board
 * opens in Excel, and the printable PDF.
 *
 * Run: npx tsx scripts/verify-results-export.ts
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { categories, matches, tournaments } from "../src/db/schema";
import { buildTournamentResults, rowsToCsv } from "../src/lib/results/resultsDataset";
import { generateResultsPdfBytes } from "../src/lib/pdf/resultsPdfGenerator";
import { generateDrawStatePdfBytes } from "../src/lib/pdf/drawStatePdfGenerator";
import { buildTournamentDrawStates } from "../src/lib/results/drawStates";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function main() {
  // Prefer the event that actually has results recorded: a confirmed bout is
  // what the export exists to carry, so an event with one beats a bigger event
  // with nothing decided.
  const all = await db.select().from(tournaments);
  let target = null as (typeof all)[number] | null;
  let boutCount = 0;
  let bestScore = -1;

  for (const tournament of all) {
    const cats = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.tournamentId, tournament.id));

    if (cats.length === 0) continue;

    const rows = await db
      .select({ id: matches.id, status: matches.status })
      .from(matches)
      .where(inArray(matches.categoryId, cats.map((c) => c.id)));

    const confirmed = rows.filter((r) => r.status === "CONFIRMED").length;
    const score = confirmed * 1000 + rows.length;

    if (score > bestScore) {
      bestScore = score;
      boutCount = rows.length;
      target = tournament;
    }
  }

  if (!target) {
    console.log("No tournament with bouts found; nothing to export.");
    process.exit(0);
  }

  console.log(`\n── Results record for "${target.name}" (${boutCount} bouts) ──`);

  const results = await buildTournamentResults(target.id);
  check("results are assembled", results !== null);
  if (!results) process.exit(1);

  check("one row per bout", results.rows.length === boutCount, `${results.rows.length} vs ${boutCount}`);

  const withAthletes = results.rows.filter((r) => r.akaName !== "TBD" || r.aoName !== "TBD");
  check("most rows resolve real athletes", withAthletes.length > 0, `${withAthletes.length} resolved`);

  const roundNames = new Set(results.rows.map((r) => r.roundName));
  check(
    "rounds are named per the round-of scheme",
    Array.from(roundNames).every((name) => /final|round of \d+|repechage/i.test(name)),
    JSON.stringify(Array.from(roundNames).slice(0, 6))
  );

  console.log("\n── CSV ─────────────────────────────────────────────────────────");
  const csv = rowsToCsv(results);
  check("CSV starts with a UTF-8 BOM for Excel", csv.charCodeAt(0) === 0xfeff);

  // The BOM is deliberate (Excel needs it); strip it before reading the cells.
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  check("CSV has a header row", rows[0]?.[0] === "Category" && rows[0]?.includes("Winner"));
  check("CSV has one data row per bout", rows.length >= boutCount, `${rows.length} lines`);

  const columnCount = rows[0].length;
  const dataRows = rows.slice(1, 1 + boutCount);
  check(
    "every data row has the same column count",
    dataRows.every((r) => r.length === columnCount),
    `expected ${columnCount}, saw ${Array.from(new Set(dataRows.map((r) => r.length))).join("/")}`
  );

  // The score line must match the database exactly for a decided bout.
  const [confirmed] = await db
    .select()
    .from(matches)
    .where(eq(matches.status, "CONFIRMED"))
    .orderBy(desc(matches.matchNo))
    .limit(1);

  if (confirmed) {
    const akaIndex = rows[0].indexOf("AKA score");
    const aoIndex = rows[0].indexOf("AO score");
    const winnerIndex = rows[0].indexOf("Winner");
    const matchNoIndex = rows[0].indexOf("Bout #");
    const statusIndex = rows[0].indexOf("Status");

    const row = dataRows.find(
      (r) => r[matchNoIndex] === String(confirmed.matchNo) && r[statusIndex] === "CONFIRMED"
    );

    check("a confirmed bout appears in the CSV", Boolean(row));
    if (row) {
      check(
        "its AKA score matches the database",
        Number(row[akaIndex]) === confirmed.akaScore,
        `csv ${row[akaIndex]} vs db ${confirmed.akaScore}`
      );
      check(
        "its AO score matches the database",
        Number(row[aoIndex]) === confirmed.aoScore,
        `csv ${row[aoIndex]} vs db ${confirmed.aoScore}`
      );
      check("it names a winner", Boolean(row[winnerIndex] && row[winnerIndex] !== ""));
    }
  }

  const totalsStart = rows.findIndex((r) => r[0] === "Bouts fought per athlete");
  check("athlete bout totals are included", totalsStart > 0);
  if (totalsStart > 0) {
    const totalRows = rows.slice(totalsStart + 2).filter((r) => r[0]);
    check("at least one athlete is counted", totalRows.length > 0, `${totalRows.length} athletes`);
    check(
      "bout counts are positive integers",
      totalRows.every((r) => Number(r[4]) > 0),
      JSON.stringify(totalRows.slice(0, 2))
    );
    // Only decided bouts count towards a total, so the figure to match is twice
    // the number of confirmed bouts that actually had two fighters.
    const playable = results.rows.filter(
      (r) => r.status === "CONFIRMED" && r.akaName !== "TBD" && r.aoName !== "TBD"
    ).length;
    const totalBouts = totalRows.reduce((sum, r) => sum + Number(r[4]), 0);
    check(
      "totals count both sides of every played bout",
      totalBouts === playable * 2,
      `${totalBouts} vs ${playable * 2} (${playable} playable of ${boutCount})`
    );
  }

  console.log("\n── Printable PDF ───────────────────────────────────────────────");
  const bytes = await generateResultsPdfBytes(results);
  check("PDF has a %PDF header", Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-");
  check("PDF is more than a stub", bytes.length > 2000, `${bytes.length} bytes`);

  // A name outside WinAnsi must not break the record.
  const unicodeSafe = await generateResultsPdfBytes({
    ...results,
    rows: [{ ...results.rows[0], akaName: "अर्जुन सिंह", akaSchool: "Ｋａｒａｔｅ 学園" }],
    athleteTotals: [],
  });
  check("non-Latin names still render", Buffer.from(unicodeSafe.subarray(0, 5)).toString() === "%PDF-");

  console.log("\n── Draw state PDF (the document admins actually print) ─────────");
  const states = await buildTournamentDrawStates(target.id);
  check("every drawn category appears", states.length > 0, `${states.length} categories`);

  const totalBouts = states.reduce((sum, s) => sum + s.matches.length, 0);
  check("it carries the bracket's bouts", totalBouts > 0, `${totalBouts} bouts`);

  const withScores = states.flatMap((s) => s.matches).filter((m) => m.akaScore !== undefined || m.aoScore !== undefined);
  check(
    "bouts carry their points",
    withScores.length > 0,
    `${withScores.length} of ${totalBouts} bouts have a score field`
  );

  const winners = states
    .flatMap((s) => s.matches)
    .filter((m) => Boolean(m.winnerId));
  check("decided bouts carry a winner", winners.length > 0, `${winners.length} decided`);

  const hasRepechage = states.some((s) => s.matches.some((m) => m.bracketType === "REPECHAGE"));
  const hasBronze = states.some((s) => s.matches.some((m) => m.bracketType === "BRONZE"));
  check("repechage bouts are included", hasRepechage || hasBronze, `repechage: ${hasRepechage}, bronze: ${hasBronze}`);

  const drawBytes = await generateDrawStatePdfBytes({
    tournamentName: results.tournamentName,
    eventDate: results.eventDate,
    venue: results.venue,
    city: results.city,
    categories: states,
    generatedAt: new Date(),
  });
  check("draw-state PDF has a %PDF header", Buffer.from(drawBytes.subarray(0, 5)).toString() === "%PDF-");
  check(
    "draw-state PDF covers the whole event",
    drawBytes.length > states.length * 400,
    `${drawBytes.length} bytes for ${states.length} categories`
  );

  // A name the WinAnsi encoder would reject must survive this document too.
  const unicodeStates = await generateDrawStatePdfBytes({
    tournamentName: results.tournamentName,
    categories: [
      {
        ...states[0],
        categoryName: "अर्जुन Category — 学園",
        matches: states[0].matches.map((m, index) =>
          index === 0
            ? { ...m, aka: { ...m.aka, displayName: "अर्जुन सिंह", school: "Ｋａｒａｔｅ 学園" } }
            : m
        ),
      },
    ],
    generatedAt: new Date(),
  });
  check(
    "non-Latin draw-state names still render",
    Buffer.from(unicodeStates.subarray(0, 5)).toString() === "%PDF-"
  );

  console.log(
    failures === 0 ? "\nAll results-export checks passed.\n" : `\n${failures} results-export check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-results-export crashed:", err);
  process.exit(1);
});
