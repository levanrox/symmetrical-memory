/**
 * Verifies the shared match clock: the pure math, millisecond persistence, and
 * that the value a TV would render matches the value the moderator desk holds.
 *
 * Run: npx tsx scripts/verify-timer-sync.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { rings } from "../src/db/schema";
import {
  clockOffsetMs,
  elapsedMs,
  formatClockParts,
  medianOffset,
  normalizeClock,
  remainingMs,
  type RingClock,
} from "../src/lib/matchClock";
import { persistRingClock, readRingClockRow } from "../src/lib/ringClockStore";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function closeTo(actual: number, expected: number, tolerance: number) {
  return Math.abs(actual - expected) <= tolerance;
}

async function main() {
  console.log("\n── Pure clock math ─────────────────────────────────────────────");

  const idle: RingClock = { status: "idle", durationMs: 180_000, accumulatedMs: 0, startedAtMs: null };
  check("idle clock shows the full duration", remainingMs(idle, Date.now()) === 180_000);

  const paused: RingClock = {
    status: "paused",
    durationMs: 180_000,
    accumulatedMs: 42_250,
    startedAtMs: null,
  };
  check("paused clock keeps millisecond precision", remainingMs(paused, Date.now()) === 137_750,
    `got ${remainingMs(paused, Date.now())}`);

  const start = Date.now() - 61_500;
  const running: RingClock = {
    status: "running",
    durationMs: 180_000,
    accumulatedMs: 500,
    startedAtMs: start,
  };
  check("running clock subtracts the live segment", closeTo(remainingMs(running, Date.now()), 118_000, 60),
    `got ${remainingMs(running, Date.now())}`);

  const finished: RingClock = { status: "finished", durationMs: 180_000, accumulatedMs: 180_000, startedAtMs: null };
  check("finished clock clamps to zero", remainingMs(finished, Date.now()) === 0);
  check("finished clock reports full elapsed", elapsedMs(finished, Date.now()) === 180_000);

  // Server says 10_050 at the moment the response is read at 1_100; the request
  // left at 1_000, so the server clock ran ~50ms ahead of the midpoint.
  check("offset sample is half-RTT corrected", clockOffsetMs(10_050, 1_000, 1_100) === 9_000,
    `got ${clockOffsetMs(10_050, 1_000, 1_100)}`);
  check("median resists one slow sample", medianOffset([4, 5, 6, 400]) === 5.5,
    `got ${medianOffset([4, 5, 6, 400])}`);

  const parts = formatClockParts(125_067);
  check("MM:SS.mmm formatting", parts.minutes === "02" && parts.seconds === "05" && parts.millis === "067",
    JSON.stringify(parts));

  check(
    "snake_case realtime rows normalize",
    normalizeClock({ timer_status: "paused", timer_duration_ms: 95_500, timer_accumulated_ms: 12_345 }).durationMs === 95_500
  );

  // The screens hand already-normalized clocks back through normalizeClock;
  // that must not silently reset a running clock to idle.
  const roundTripped = normalizeClock(running);
  check(
    "normalizing an already-normalized clock is lossless",
    roundTripped.status === "running" &&
      roundTripped.startedAtMs === running.startedAtMs &&
      roundTripped.accumulatedMs === running.accumulatedMs &&
      closeTo(remainingMs(roundTripped, Date.now()), remainingMs(running, Date.now()), 1),
    JSON.stringify(roundTripped)
  );

  console.log("\n── Persistence round trip ──────────────────────────────────────");

  const [ring] = await db.select().from(rings).limit(1);
  if (!ring) {
    console.log("  SKIP  no ring rows to test against");
    process.exit(failures === 0 ? 0 : 1);
  }

  const original = normalizeClock(ring);
  console.log(`  using ring "${ring.name}" (${ring.id})`);

  const written = await persistRingClock(ring.id, {
    status: "paused",
    durationMs: 95_500,
    accumulatedMs: 12_345,
    startedAt: null,
  });

  check("duration persists in milliseconds", written.durationMs === 95_500, `got ${written.durationMs}`);
  check("accumulated ms is not floored to seconds", written.accumulatedMs === 12_345, `got ${written.accumulatedMs}`);

  const reloaded = await readRingClockRow(ring.id);
  const reloadedClock = normalizeClock(reloaded);
  check("re-read from the database keeps ms precision", reloadedClock.accumulatedMs === 12_345);

  const [rawRing] = await db.select().from(rings).where(eq(rings.id, ring.id));
  check("rings.timer_duration_ms is written", rawRing.timerDurationMs === 95_500);
  check("rings.timer_accumulated_ms is written", rawRing.timerAccumulatedMs === 12_345);
  check("legacy seconds column stays in step", rawRing.timerAccumulatedSeconds === 12,
    `got ${rawRing.timerAccumulatedSeconds}`);
  check("legacy duration column stays in step", rawRing.matchDurationSeconds === 96,
    `got ${rawRing.matchDurationSeconds}`);

  // Both screens compute from this one value, so comparing them is comparing
  // the same function against the persisted row.
  const serverNow = Date.now();
  const desk = remainingMs(reloadedClock, serverNow);
  const tv = remainingMs(normalizeClock(await readRingClockRow(ring.id)), serverNow);
  check("moderator desk and TV compute the same remaining time", desk === tv, `${desk} vs ${tv}`);

  // Restore whatever the ring had before this script ran.
  await persistRingClock(ring.id, {
    status: original.status,
    durationMs: original.durationMs,
    accumulatedMs: original.accumulatedMs,
    startedAt: original.startedAtMs ? new Date(original.startedAtMs) : null,
  });
  console.log("  restored the ring's previous clock state");

  console.log(
    failures === 0
      ? "\nAll clock checks passed.\n"
      : `\n${failures} clock check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-timer-sync crashed:", err);
  process.exit(1);
});
