import { db } from "@/db";
import { rings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { normalizeClock, type ClockStatus, type RingClock } from "@/lib/matchClock";

/**
 * Raw persistence for the match clock. Authorization lives in the server
 * actions (`actions/clock.ts`, `actions/rings.ts`); this module only touches
 * the database so both callers share exactly one write path.
 */

export interface RingClockRow {
  id: string;
  timerStatus: string;
  timerDurationMs: number;
  timerAccumulatedMs: number;
  timerStartedAt: Date | null;
  sidesSwapped: boolean;
}

export const RING_CLOCK_COLUMNS = {
  id: rings.id,
  timerStatus: rings.timerStatus,
  timerDurationMs: rings.timerDurationMs,
  timerAccumulatedMs: rings.timerAccumulatedMs,
  timerStartedAt: rings.timerStartedAt,
  sidesSwapped: rings.sidesSwapped,
};

export async function readRingClockRow(ringId: string): Promise<RingClockRow | null> {
  const [ring] = await db.select(RING_CLOCK_COLUMNS).from(rings).where(eq(rings.id, ringId));
  return (ring as RingClockRow | undefined) ?? null;
}

export async function persistRingClock(
  ringId: string,
  next: {
    status: ClockStatus;
    durationMs: number;
    accumulatedMs: number;
    startedAt: Date | null;
  }
): Promise<RingClock> {
  const clock: RingClock = {
    status: next.status,
    durationMs: Math.max(1000, Math.round(next.durationMs)),
    accumulatedMs: Math.max(0, Math.min(Math.round(next.accumulatedMs), Math.round(next.durationMs))),
    startedAtMs: next.startedAt ? next.startedAt.getTime() : null,
  };

  await db
    .update(rings)
    .set({
      timerStatus: clock.status,
      timerStartedAt: next.startedAt,
      timerPausedAt: clock.status === "paused" ? new Date() : null,
      timerDurationMs: clock.durationMs,
      timerAccumulatedMs: clock.accumulatedMs,
      // Legacy second-precision columns kept in step for any older reader.
      timerAccumulatedSeconds: Math.round(clock.accumulatedMs / 1000),
      matchDurationSeconds: Math.round(clock.durationMs / 1000),
    })
    .where(eq(rings.id, ringId));

  revalidateRingClock(ringId);
  return clock;
}

export function revalidateRingClock(ringId: string) {
  try {
    revalidatePath(`/scoreboard/${ringId}`);
    revalidatePath(`/moderator/ring/${ringId}/current`);
  } catch {}
}

export function clockToPersist(clock: RingClock, overrides?: Partial<RingClock>) {
  const merged = { ...clock, ...overrides };
  return {
    status: merged.status,
    durationMs: merged.durationMs,
    accumulatedMs: merged.accumulatedMs,
    startedAt: merged.startedAtMs ? new Date(merged.startedAtMs) : null,
  };
}

export { normalizeClock };
