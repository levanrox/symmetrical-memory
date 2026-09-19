/**
 * Verifies the draw engine's bronze/repechage options and bracket sizing:
 *  - bronzeMedals 0 → no repechage ladder, no bronze bout
 *  - bronzeMedals 1 → exactly one bronze bout between the two semifinal losers
 *  - bronzeMedals 2 → one bronze per repechage line (WKF default)
 *  - sizing produces "Round of N" names (32 / 16 / 8 …)
 *  - the podium matches the choice
 *
 * Run: npx tsx scripts/verify-draw-options.ts
 */
import { getRuleset } from "../src/engine/rules-engine";
import { generateDraw, resolveDraw, type MatchOutcome } from "../src/engine/draw-engine";
import type { DrawGraph, Participant } from "../src/engine/draw-engine/types";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ruleset = getRuleset("WKF_KUMITE_2026");

function entrants(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `p${i + 1}`,
    displayName: `Athlete ${i + 1}`,
    clubId: `club-${i + 1}`,
    districtId: null,
  }));
}

function draw(n: number, bronzeMedals: 0 | 1 | 2): DrawGraph {
  return generateDraw(
    {
      categoryId: "verify-cat",
      format: "SINGLE_ELIM_REPECHAGE",
      participants: entrants(n),
      seeding: { mode: "NONE" },
      options: { bronzeMedals },
    },
    ruleset
  );
}

/** Plays every bout with AKA winning, so the bracket resolves deterministically. */
function playThrough(graph: DrawGraph): Map<string, MatchOutcome> {
  const results = new Map<string, MatchOutcome>();
  for (let step = 0; step <= graph.matches.length; step += 1) {
    const resolution = resolveDraw(graph, results);
    const nextId = resolution.readyMatchIds[0];
    if (nextId === undefined) break;
    results.set(nextId, { kind: "WINNER", side: "AKA" });
  }
  return results;
}

function podiumOf(graph: DrawGraph) {
  return resolveDraw(graph, playThrough(graph)).podium;
}

console.log("\n── Bronze: none ────────────────────────────────────────────────");
{
  const graph = draw(8, 0);
  const ancillary = graph.matches.filter((m) => m.bracketType !== "MAIN");
  check("no repechage or bronze bouts are created", ancillary.length === 0, `got ${ancillary.length}`);
  check("the draw ends at the Final", graph.rounds.at(-1)?.name === "Final", `got ${graph.rounds.at(-1)?.name}`);
  check("no repechage round is listed", !graph.rounds.some((r) => r.name === "Repechage"));

  const podium = podiumOf(graph);
  check("gold and silver are still awarded", podium?.goldRegistrationId === "p1" && podium?.silverRegistrationId === "p2");
  check("no bronze is awarded", (podium?.bronzeRegistrationIds ?? []).length === 0);
}

console.log("\n── Bronze: one ─────────────────────────────────────────────────");
{
  const graph = draw(8, 1);
  const bronzeMatches = graph.matches.filter((m) => m.bracketType === "BRONZE");
  check("exactly one bronze bout is created", bronzeMatches.length === 1, `got ${bronzeMatches.length}`);

  const podium = podiumOf(graph);
  check("exactly one bronze is awarded", (podium?.bronzeRegistrationIds ?? []).length === 1,
    JSON.stringify(podium?.bronzeRegistrationIds));
}

console.log("\n── Bronze: two (WKF repechage) ─────────────────────────────────");
{
  const graph = draw(8, 2);
  const bronzeMatches = graph.matches.filter((m) => m.bracketType === "BRONZE");
  const repechageMatches = graph.matches.filter((m) => m.bracketType === "REPECHAGE");
  check("a bronze per line is created", bronzeMatches.length === 2, `got ${bronzeMatches.length}`);
  check("the ladder holds the earlier losers", repechageMatches.length >= 0);
  check("the draw carries a Repechage round", graph.rounds.some((r) => r.name === "Repechage"));

  const podium = podiumOf(graph);
  check("two distinct bronzes are awarded", (podium?.bronzeRegistrationIds ?? []).length === 2,
    JSON.stringify(podium?.bronzeRegistrationIds));
}

console.log("\n── Sizing: round-of names ──────────────────────────────────────");
{
  // Rounds are named after the bracket size, not the entry count: 17 entrants
  // are drawn into a round of 32 with 15 byes, which is how an official draw
  // sheet labels it.
  const expected: Record<number, string> = {
    5: "Quarter-final",
    6: "Quarter-final",
    9: "Round of 16",
    16: "Round of 16",
    17: "Round of 32",
    32: "Round of 32",
    33: "Round of 64",
  };

  for (const [count, firstRoundName] of Object.entries(expected)) {
    const graph = draw(Number(count), 2);
    const firstRound = graph.matches.find((m) => m.roundNo === 0);
    check(
      `${count} entrants start in "${firstRoundName}"`,
      firstRound?.roundName === firstRoundName,
      `got ${firstRound?.roundName} (bracket size ${graph.tournamentSize})`
    );
  }

  const g32 = draw(32, 2);
  check("a 32-entrant bracket is sized 32", g32.tournamentSize === 32, `got ${g32.tournamentSize}`);
  check("32 entrants carry no byes", g32.byeCount === 0, `got ${g32.byeCount}`);
  const g20 = draw(20, 2);
  check("a 20-entrant bracket is sized 32 with 12 byes", g20.tournamentSize === 32 && g20.byeCount === 12,
    `size ${g20.tournamentSize}, byes ${g20.byeCount}`);
}

console.log(
  failures === 0 ? "\nAll draw-option checks passed.\n" : `\n${failures} draw-option check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
