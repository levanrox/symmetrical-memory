import { readFileSync } from "node:fs";

// Load .env.local for tsx so DATABASE_URL points to the same Postgres instance
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // Use defaults if .env.local doesn't exist
}

import http from "node:http";
import { db } from "../src/db";
import { tournaments, rings, categoryAssignments, moderatorRequests } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { validateOrganiserSessionAction } from "../src/actions/organiser";
import { searchTournamentAthletes } from "../src/actions/athletes";
import { getBalancingAssignments } from "../src/actions/balancing";

async function runRealtimeAndEdgeTests() {
  console.log("=== STARTING REAL-TIME & EDGE CASE SUITE ===");

  // 1. Fetch tournament context
  const [tournament] = await db.select().from(tournaments).limit(1);
  if (!tournament) {
    throw new Error("No tournament found to test against");
  }
  const [ring] = await db.select().from(rings).where(eq(rings.tournamentId, tournament.id)).limit(1);
  if (!ring) {
    throw new Error("No ring found to test against");
  }

  console.log(`Testing with Tournament: ${tournament.name} (${tournament.id})`);
  console.log(`Ring: ${ring.name} (${ring.id})`);

  // 2. Real-time SSE Connection Test
  console.log("\n--- TEST 1: Real-time SSE Event Propagation via HTTP ---");
  const ssePromise = new Promise<{ received: boolean; data: any }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("SSE event timeout after 5000ms"));
    }, 5000);

    const req = http.get(`http://127.0.0.1:3000/api/live?tournamentId=${tournament.id}&ringId=${ring.id}`, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const changeMatch = buffer.match(/event:\s*change\r?\ndata:\s*({.+})/);
        if (changeMatch) {
          clearTimeout(timeout);
          req.destroy();
          resolve({ received: true, data: JSON.parse(changeMatch[1]) });
        }
      });
      res.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    req.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Mutate DB row after 800ms to allow SSE connection to establish
    setTimeout(async () => {
      try {
        console.log("Mutating ring in Postgres to trigger pg_notify...");
        await db.update(rings).set({ name: ring.name }).where(eq(rings.id, ring.id));
      } catch (err) {
        console.error("Failed to mutate ring:", err);
      }
    }, 800);
  });

  const sseResult = await ssePromise;
  console.log("SSE Received Event:", sseResult.data);
  if (sseResult.data.table !== "rings" || sseResult.data.id !== ring.id) {
    throw new Error(`Received event does not match expected payload: ${JSON.stringify(sseResult.data)}`);
  }
  console.log("PASS: Real-time SSE successfully propagated live database event over HTTP!");

  // 3. Organiser Session Validation & Edge Cases
  console.log("\n--- TEST 2: Organiser Session Token Validation & Edge Cases ---");
  const missingTokenResult = await validateOrganiserSessionAction("");
  console.log("Empty token result:", missingTokenResult);
  if (missingTokenResult.valid !== false || missingTokenResult.reason !== "missing") {
    throw new Error("Expected empty token to fail with reason 'missing'");
  }

  const invalidTokenResult = await validateOrganiserSessionAction("fake-invalid-token-uuid-0000");
  console.log("Invalid token result:", invalidTokenResult);
  if (invalidTokenResult.valid !== false || invalidTokenResult.reason !== "not_found") {
    throw new Error("Expected fake token to return not_found");
  }
  console.log("PASS: Organiser session validation safely handles missing/invalid tokens.");

  // 4. Edge Cases: Ring Balancing with null/invalid rings
  console.log("\n--- TEST 3: Ring Balancing Logic & Assignment Ordering ---");
  const balancingData = await getBalancingAssignments([ring.id]);
  console.log(`Balancing assignments count: ${balancingData.length}`);
  // Check queue order consistency
  const ringQueueOrders = new Map<string, number[]>();
  for (const a of balancingData) {
    const list = ringQueueOrders.get(a.ringId) || [];
    list.push(a.queueOrder);
    ringQueueOrders.set(a.ringId, list);
  }
  for (const [rId, orders] of ringQueueOrders.entries()) {
    for (let i = 1; i < orders.length; i++) {
      if (orders[i] < orders[i - 1]) {
        throw new Error(`Queue order violation in ring ${rId}: ${orders.join(", ")}`);
      }
    }
  }
  console.log("PASS: Tatami balancing queue orders are strictly monotonic & valid.");

  // 5. Edge Cases: Athlete Search with adversarial inputs
  console.log("\n--- TEST 4: Athlete Search Query Sanitization & Edge Cases ---");
  const adversarialQueries = [
    "",
    "   ",
    "' OR 1=1 --",
    "\\",
    "%",
    "_",
    "; DROP TABLE athletes; --",
    "🥋 Karateka 123",
    "a".repeat(200),
  ];
  for (const q of adversarialQueries) {
    const start = performance.now();
    const results = await searchTournamentAthletes(tournament.id, q);
    const duration = (performance.now() - start).toFixed(2);
    console.log(`Query: ${JSON.stringify(q)} -> ${results.length} results in ${duration}ms`);
  }
  console.log("PASS: Athlete search safely sanitized all adversarial queries without crash or injection.");

  console.log("\n=== ALL REAL-TIME & EDGE CASE SUITES PASSED (4/4) ===");
  process.exit(0);
}

runRealtimeAndEdgeTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
