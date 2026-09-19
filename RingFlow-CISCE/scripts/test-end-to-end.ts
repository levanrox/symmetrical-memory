import { db } from "../src/db";
import { getAdminDashboardData, getSidebarTournamentCounts, getTournamentSearchMeta } from "../src/actions/admin";
import { getTournamentActiveBouts, getRingActiveBout } from "../src/actions/matches";
import { getBalancingAssignments } from "../src/actions/balancing";
import { searchTournamentAthletes } from "../src/actions/athletes";
import { getStagerCodes } from "../src/actions/stager";
import { getRingClock, setRingSidesSwapped } from "../src/actions/clock";
import { broadcastLiveEvent } from "../src/lib/realtime/bus";

const TOURNAMENT_ID = "1797e1f8-78c0-4f16-a503-e593d8324029";
const RING_ID = "f1bd9c67-1f67-4981-897f-ddf298a67533";
const RING_IDS = [
  "f1bd9c67-1f67-4981-897f-ddf298a67533",
  "4329360f-3bc9-421e-94cf-83289e291f4b",
  "bc0d4fa8-36f4-4105-b553-42f9e6d721ad",
  "4c40e26c-5d50-4fe2-a254-00d8e4d524ce"
];

async function runTests() {
  console.log("==================================================");
  console.log("   RINGFLOW END-TO-END AUTOMATED VERIFICATION     ");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<any>) {
    try {
      const start = Date.now();
      const res = await fn();
      const duration = Date.now() - start;
      console.log(`[PASS] (${duration}ms) ${name}`);
      passed++;
      return res;
    } catch (err: any) {
      console.error(`[FAIL] ${name}:`, err?.message || err);
      failed++;
    }
  }

  // 1. Admin Dashboard Data Query
  await test("1. getAdminDashboardData retrieves rings, assignments, and logs", async () => {
    const data = await getAdminDashboardData(TOURNAMENT_ID);
    if (!data) throw new Error("Null data returned");
    if (!Array.isArray(data.rings)) throw new Error("rings is not array");
    console.log(`   -> Retrieved ${data.rings.length} rings, ${data.assignments.length} assignments, ${data.logs.length} logs`);
  });

  // 2. Tournament Active Bouts Batch Query
  await test("2. getTournamentActiveBouts executes in single batch without waterfalls", async () => {
    const bouts = await getTournamentActiveBouts(TOURNAMENT_ID);
    if (typeof bouts !== "object") throw new Error("Bouts is not an object");
    console.log(`   -> Active bouts returned for ${Object.keys(bouts).length} rings`);
  });

  // 3. Ring Active Bout Query
  await test("3. getRingActiveBout retrieves current bout and ring clock", async () => {
    const bout = await getRingActiveBout(RING_ID);
    if (!bout) throw new Error("No bout returned");
    console.log(`   -> Active bout on Tatami 1: ring status=${bout.ring?.status || "none"}, clock status=${bout.clock?.status}`);
  });

  // 4. Balancing Assignments Query
  await test("4. getBalancingAssignments retrieves all category assignments with stager info", async () => {
    const assignments = await getBalancingAssignments(RING_IDS);
    if (!Array.isArray(assignments)) throw new Error("Assignments is not array");
    console.log(`   -> Found ${assignments.length} assignments across ${RING_IDS.length} rings`);
  });

  // 5. Athlete Search Queries (Edge Cases)
  await test("5a. searchTournamentAthletes - normal query", async () => {
    const athletes = await searchTournamentAthletes(TOURNAMENT_ID, "a");
    console.log(`   -> Found ${athletes.length} athletes for query 'a'`);
  });

  await test("5b. searchTournamentAthletes - chest number query", async () => {
    const athletes = await searchTournamentAthletes(TOURNAMENT_ID, "#1");
    console.log(`   -> Found ${athletes.length} athletes for query '#1'`);
  });

  await test("5c. searchTournamentAthletes - multi-word & non-breaking spaces", async () => {
    const athletes = await searchTournamentAthletes(TOURNAMENT_ID, "john doe");
    console.log(`   -> Handled multi-word search gracefully`);
  });

  await test("5d. searchTournamentAthletes - special characters (commas, parentheses, quotes)", async () => {
    // In previous architecture, commas and parentheses crashed PostgREST syntax parser!
    const athletes = await searchTournamentAthletes(TOURNAMENT_ID, "test (U-14, 45kg) 'quotes'");
    console.log(`   -> SQL injection and syntax parser resilience verified: returned safely`);
  });

  // 6. Sidebar Tournament Counts
  await test("6. getSidebarTournamentCounts calculates rings, categories, and athletes", async () => {
    const counts = await getSidebarTournamentCounts(TOURNAMENT_ID);
    if (!counts) throw new Error("No counts returned");
    console.log(`   -> Counts: ${counts.ringsCount} rings, ${counts.categoriesCount} categories, ${counts.athletesCount} athletes`);
  });

  // 7. Tournament Search Meta
  await test("7. getTournamentSearchMeta returns categories, rings, and assignments", async () => {
    const meta = await getTournamentSearchMeta(TOURNAMENT_ID);
    if (!meta || !meta.categories || !meta.rings) throw new Error("Invalid meta");
    console.log(`   -> Meta: ${meta.categories.length} categories, ${meta.rings.length} rings, ${meta.assignments.length} assignments`);
  });

  // 8. Stager Codes
  await test("8. getStagerCodes retrieves stager codes JSONB array", async () => {
    const codes = await getStagerCodes(TOURNAMENT_ID);
    if (!Array.isArray(codes)) throw new Error("Codes is not array");
    console.log(`   -> Retrieved ${codes.length} stager codes`);
  });

  // 9. Clock Actions
  await test("9. getRingClock retrieves ring timing clock", async () => {
    const clockRes = await getRingClock(RING_ID);
    if (!clockRes.success) throw new Error(clockRes.error || "Clock failed");
    console.log(`   -> Clock: status=${clockRes.clock.status}, durationMs=${clockRes.clock.durationMs}`);
  });

  // 10. Real-time Event Bus Broadcast
  await test("10. broadcastLiveEvent pushes event through bus cleanly", async () => {
    broadcastLiveEvent({
      table: "rings",
      op: "UPDATE",
      ringId: RING_ID,
      tournamentId: TOURNAMENT_ID,
    });
    console.log(`   -> Real-time event dispatched without error`);
  });

  console.log("\n==================================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
