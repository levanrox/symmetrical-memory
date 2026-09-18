"use server";

import { db } from "@/db";
import { rings, moderatorRequests } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ensureAdmin, ensureAdminOwnsTournament } from "./admin";
import { ensureOrganiser } from "./organiser";

import { generateAccessCode } from "@/lib/utils";
import { elapsedMs as elapsedFor, normalizeClock } from "@/lib/matchClock";
import { persistRingClock, readRingClockRow } from "@/lib/ringClockStore";

export async function addRing(tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const existingRings = await db
    .select({ ringOrder: rings.ringOrder })
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId));

  const newOrder = existingRings.length + 1;
  const newName = `Tatami ${String(newOrder).padStart(2, "0")}`;

  const [newRing] = await db
    .insert(rings)
    .values({
      tournamentId,
      name: newName,
      ringOrder: newOrder,
      accessCode: generateAccessCode(),
    })
    .returning();

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return {
    id: newRing.id,
    name: newRing.name,
    ring_order: newRing.ringOrder,
    access_code: newRing.accessCode,
  };
}

export async function regenerateRingCode(ringId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const newCode = generateAccessCode();
  await db
    .update(rings)
    .set({ accessCode: newCode })
    .where(and(eq(rings.id, ringId), eq(rings.tournamentId, tournamentId)));

  await db
    .update(moderatorRequests)
    .set({ status: "expired" })
    .where(
      and(
        eq(moderatorRequests.ringId, ringId),
        eq(moderatorRequests.status, "pending")
      )
    );

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true, access_code: newCode };
}

export async function deleteRing(ringId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db
    .delete(rings)
    .where(and(eq(rings.id, ringId), eq(rings.tournamentId, tournamentId)));

  revalidatePath(`/admin/event/${tournamentId}/rings`);
}

/**
 * Admin floor controls for the tatami clock. They write through the same
 * millisecond store as the moderator desk, so the arena display never sees a
 * second, drifting version of the same clock.
 */
export async function startRingTimer(ringId: string, tournamentId: string) {
  await ensureAdmin();

  const row = await readRingClockRow(ringId);
  if (!row) return { success: false, error: "Ring not found" };

  const clock = normalizeClock(row);
  if (clock.status === "running") return { success: true };

  await persistRingClock(ringId, {
    status: "running",
    durationMs: clock.durationMs,
    accumulatedMs: elapsedFor(clock, Date.now()),
    startedAt: new Date(),
  });

  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  revalidatePath(`/organiser/event/${tournamentId}/dashboard`);
  return { success: true };
}

export async function pauseRingTimer(ringId: string, tournamentId: string) {
  await ensureAdmin();

  const row = await readRingClockRow(ringId);
  if (!row) return { success: false, error: "Ring not found" };

  const clock = normalizeClock(row);

  await persistRingClock(ringId, {
    status: "paused",
    durationMs: clock.durationMs,
    accumulatedMs: elapsedFor(clock, Date.now()),
    startedAt: null,
  });

  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  revalidatePath(`/organiser/event/${tournamentId}/dashboard`);
  return { success: true };
}

export async function resumeRingTimer(ringId: string, tournamentId: string) {
  return startRingTimer(ringId, tournamentId);
}

export async function resetRingTimer(ringId: string, tournamentId: string) {
  await ensureAdmin();

  const row = await readRingClockRow(ringId);
  if (!row) return { success: false, error: "Ring not found" };

  await persistRingClock(ringId, {
    status: "idle",
    durationMs: normalizeClock(row).durationMs,
    accumulatedMs: 0,
    startedAt: null,
  });

  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  revalidatePath(`/organiser/event/${tournamentId}/dashboard`);
  return { success: true };
}

export async function toggleRingTimer(ringId: string, tournamentId: string, currentStatus: string) {
  if (currentStatus === "running") {
    return pauseRingTimer(ringId, tournamentId);
  } else {
    return startRingTimer(ringId, tournamentId);
  }
}

export async function setAllRingTimers(tournamentId: string, pause: boolean) {
  // Authorize admin or organiser
  let isAuthorized = false;
  try {
    await ensureAdmin();
    isAuthorized = true;
  } catch {
    try {
      await ensureOrganiser();
      isAuthorized = true;
    } catch {}
  }
  if (!isAuthorized) {
    throw new Error("Unauthorized to set ring timers");
  }

  const tournamentRings = await db
    .select({ id: rings.id })
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId));

  if (tournamentRings.length === 0) return { success: true };

  for (const { id } of tournamentRings) {
    const row = await readRingClockRow(id);
    if (!row) continue;

    const clock = normalizeClock(row);

    if (pause) {
      if (clock.status !== "running") continue;
      await persistRingClock(id, {
        status: "paused",
        durationMs: clock.durationMs,
        accumulatedMs: elapsedFor(clock, Date.now()),
        startedAt: null,
      });
    } else {
      if (clock.status === "running") continue;
      await persistRingClock(id, {
        status: "running",
        durationMs: clock.durationMs,
        accumulatedMs: elapsedFor(clock, Date.now()),
        startedAt: new Date(),
      });
    }
  }

  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  revalidatePath(`/organiser/event/${tournamentId}/dashboard`);
  return { success: true };
}
