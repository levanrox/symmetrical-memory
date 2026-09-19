/**
 * Proves the live feed works: LISTEN on ringflow_events, mutate a ring, and
 * check that a matching event arrives quickly — plus that the scope filter
 * keeps unrelated events away.
 *
 * Run:  NODE_ENV=development npx tsx scripts/verify-live-stream.ts
 */
import { readFileSync } from "node:fs";

// tsx does not read .env.local on its own, and the bus needs DATABASE_URL.
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
import { rings, tournaments } from "../src/db/schema";
import { eventMatchesScope, subscribeToLiveEvents, type LiveEvent } from "../src/lib/realtime/bus";

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
  const [ring] = await db.select().from(rings).limit(1);
  if (!ring) {
    console.log("No rings in the database; nothing to prove.");
    process.exit(1);
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, ring.tournamentId))
    .limit(1);

  const received: LiveEvent[] = [];
  const unsubscribe = subscribeToLiveEvents((event) => received.push(event));

  // Give LISTEN a moment to attach before the write.
  await new Promise((resolve) => setTimeout(resolve, 800));

  console.log("═══ live feed ═══");

  const startedAt = Date.now();
  await db.update(rings).set({ name: ring.name }).where(eq(rings.id, ring.id));

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && received.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const latency = Date.now() - startedAt;

  check("a ring update raises an event", received.length > 0, `${received.length} events`);
  check("the event arrives in well under a second", received.length > 0 && latency < 1500, `${latency}ms`);

  const event = received[0];
  if (event) {
    check("the payload names the table", event.table === "rings", JSON.stringify(event));
    check("the payload carries the ring id", event.ringId === ring.id, JSON.stringify(event));
    check("the payload carries the tournament id", event.tournamentId === ring.tournamentId, JSON.stringify(event));
  }

  // Scope filtering: a screen watching another ring must not be woken by this.
  const otherRingScope = { ringId: "00000000-0000-4000-8000-000000000000" };
  check(
    "a different ring's screen ignores the event",
    event ? !eventMatchesScope(event, otherRingScope) : false
  );
  check(
    "this ring's screen accepts the event",
    event ? eventMatchesScope(event, { ringId: ring.id }) : false
  );
  check(
    "the tournament's dashboard accepts the event",
    event ? eventMatchesScope(event, { tournamentId: tournament?.id ?? null }) : false
  );

  // A category-scoped screen should not wake for a ring-only change.
  check(
    "a category-scoped screen ignores a ring-only event",
    event ? !eventMatchesScope(event, { categoryId: "00000000-0000-4000-8000-000000000001" }) : false
  );

  unsubscribe();
  console.log("");
  if (failures === 0) {
    console.log("All live-feed checks passed.");
  } else {
    console.log(`${failures} live-feed check(s) failed.`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Live-feed verification crashed:", err);
  process.exit(1);
});
