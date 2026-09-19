/**
 * Verifies the athlete search exactly as the UI runs it now: terms passed as
 * filter values (never interpolated into or=(…)), `*` as the wildcard, and
 * whitespace-insensitive matching for multiple words.
 *
 * Run: npx tsx scripts/verify-athlete-search.ts
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// tsx does not read .env.local, and the browser client the app uses takes its
// URL and anon key from there.
function loadLocalEnv() {
  const needed = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (needed.every((key) => process.env[key])) return;

  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  } catch {}
}

loadLocalEnv();

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Same query the public page and the header search now issue. */
async function searchAthletes(supabase: SupabaseClient, tournamentId: string, rawQuery: string) {
  const cleanQ = rawQuery.replace(/^#/, "").trim();
  const words = cleanQ.split(/[\s\u00A0\u2000-\u200B]+/).filter(Boolean);
  const pattern = words.length > 1 ? `*${words.join("*")}*` : `*${cleanQ}*`;
  const columns = "id, name, chest_number, category_id";

  const [byName, byChest] = await Promise.all([
    supabase
      .from("athletes")
      .select(columns)
      .eq("tournament_id", tournamentId)
      .ilike("name", pattern)
      .limit(20),
    supabase
      .from("athletes")
      .select(columns)
      .eq("tournament_id", tournamentId)
      .ilike("chest_number", pattern)
      .limit(20),
  ]);

  return {
    error: byName.error?.message ?? byChest.error?.message ?? null,
    rows: [...(byName.data ?? []), ...(byChest.data ?? [])],
    pattern,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const supabase = createClient(url, key);

  const { data: tournaments, error: tournamentsError } = await supabase
    .from("tournaments")
    .select("id, name")
    .limit(10);

  check("the gateway answers", !tournamentsError, tournamentsError?.message);
  if (!tournaments || tournaments.length === 0) {
    console.log("  SKIP  no tournaments to search");
    process.exit(failures === 0 ? 0 : 1);
  }

  // Search the event that actually holds the roster: the populated one, not
  // simply the first tournament the API happens to return.
  const counts = await Promise.all(
    tournaments.map(async (t) => {
      const { count } = await supabase
        .from("athletes")
        .select("*", { count: "exact", head: true })
        .eq("tournament_id", t.id);
      return { ...t, count: count ?? 0 };
    })
  );
  counts.sort((a, b) => b.count - a.count);

  const target = counts.find((t) => t.count > 0);
  if (!target) {
    console.log("  SKIP  no tournament has athletes to search");
    process.exit(failures === 0 ? 0 : 1);
  }

  const tournamentId = target.id;
  console.log(`\n── Searching in "${target.name}" (${target.count} athletes) ──`);

  // Terms that used to fail or silently return nothing.
  const cases: { query: string; expectRows: boolean; note: string }[] = [
    { query: "JOYCEE ANDREA", expectRows: true, note: "two words typed with ordinary spaces" },
    { query: "joycee andrea a", expectRows: true, note: "full name" },
    { query: "joycee", expectRows: true, note: "single word" },
    { query: "136", expectRows: true, note: "chest number" },
    { query: "a", expectRows: true, note: "single letter" },
    { query: "O'Brien", expectRows: false, note: "apostrophe must not error" },
    { query: "Mary-Jane", expectRows: false, note: "hyphen must not error" },
    { query: "Smith, John", expectRows: false, note: "comma must not error" },
    { query: "zzzznobody", expectRows: false, note: "genuinely absent name" },
  ];

  console.log("\n── Query behaviour ─────────────────────────────────────────────");

  for (const { query, expectRows, note } of cases) {
    const { error, rows, pattern } = await searchAthletes(supabase, tournamentId, query);

    check(`"${query}" returns without error (${note})`, error === null, error ?? undefined);

    if (expectRows) {
      check(`"${query}" finds at least one athlete`, rows.length > 0, `pattern ${pattern}`);
    } else {
      check(`"${query}" returns an empty list, not an error`, rows.length === 0, `${rows.length} rows`);
    }
  }

  console.log(
    failures === 0 ? "\nAll athlete-search checks passed.\n" : `\n${failures} athlete-search check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-athlete-search crashed:", err);
  process.exit(1);
});
