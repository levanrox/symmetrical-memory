"use server";

import { db } from "@/db";
import { rings, moderatorRequests } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { ensureAdmin, ensureAdminOwnsTournament } from "./admin";
import { ensureOrganiser } from "./organiser";

import { generateAccessCode } from "@/lib/utils";

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

export async function startRingTimer(ringId: string, tournamentId: string) {
  await ensureAdmin();
  const supabase = await createClient();
  const now = new Date().toISOString();

  let query = supabase
    .from("rings")
    .select("timer_status, timer_accumulated_seconds")
    .eq("id", ringId);

  if (tournamentId) {
    query = query.eq("tournament_id", tournamentId);
  }

  const { data: ring } = await query.single();
  if (!ring) return { success: false, error: "Ring not found" };

  const accumulated = ring.timer_accumulated_seconds || 0;

  const { error } = await supabase
    .from("rings")
    .update({
      timer_status: "running",
      timer_started_at: now,
      timer_paused_at: null,
      timer_accumulated_seconds: accumulated,
    })
    .eq("id", ringId);

  if (error) {
    console.error("Error starting ring timer:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  revalidatePath(`/organiser/event/${tournamentId}/dashboard`);
  return { success: true };
}

export async function pauseRingTimer(ringId: string, tournamentId: string) {
  await ensureAdmin();
  const supabase = await createClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  let query = supabase
    .from("rings")
    .select("timer_status, timer_started_at, timer_accumulated_seconds")
    .eq("id", ringId);

  if (tournamentId) {
    query = query.eq("tournament_id", tournamentId);
  }

  const { data: ring } = await query.single();

  if (!ring) return { success: false };

  let additionalSeconds = 0;
  if (ring.timer_status === "running" && ring.timer_started_at) {
    additionalSeconds = Math.max(0, Math.floor((now - new Date(ring.timer_started_at).getTime()) / 1000));
  }

  const newAccumulated = (ring.timer_accumulated_seconds || 0) + additionalSeconds;

  const { error } = await supabase
    .from("rings")
    .update({
      timer_status: "paused",
      timer_started_at: null,
      timer_paused_at: nowIso,
      timer_accumulated_seconds: newAccumulated,
    })
    .eq("id", ringId);

  if (error) {
    console.error("Error pausing ring timer:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  revalidatePath(`/organiser/event/${tournamentId}/dashboard`);
  return { success: true };
}

export async function resumeRingTimer(ringId: string, tournamentId: string) {
  return startRingTimer(ringId, tournamentId);
}

export async function resetRingTimer(ringId: string, tournamentId: string) {
  await ensureAdmin();
  const supabase = await createClient();
  let updateQuery = supabase
    .from("rings")
    .update({
      timer_status: "idle",
      timer_started_at: null,
      timer_paused_at: null,
      timer_accumulated_seconds: 0,
    })
    .eq("id", ringId);

  if (tournamentId) {
    updateQuery = updateQuery.eq("tournament_id", tournamentId);
  }

  const { error } = await updateQuery;

  if (error) {
    console.error("Error resetting ring timer:", error);
    return { success: false, error: error.message };
  }

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

  const supabase = await createClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: rings } = await supabase
    .from("rings")
    .select("id, timer_status, timer_started_at, timer_accumulated_seconds")
    .eq("tournament_id", tournamentId);

  if (!rings || rings.length === 0) return { success: true };

  for (const ring of rings) {
    if (pause) {
      if (ring.timer_status === "running") {
        let additional = 0;
        if (ring.timer_started_at) {
          additional = Math.max(0, Math.floor((now - new Date(ring.timer_started_at).getTime()) / 1000));
        }
        await supabase
          .from("rings")
          .update({
            timer_status: "paused",
            timer_started_at: null,
            timer_paused_at: nowIso,
            timer_accumulated_seconds: (ring.timer_accumulated_seconds || 0) + additional,
          })
          .eq("id", ring.id);
      }
    } else {
      if (ring.timer_status !== "running") {
        await supabase
          .from("rings")
          .update({
            timer_status: "running",
            timer_started_at: nowIso,
            timer_paused_at: null,
          })
          .eq("id", ring.id);
      }
    }
  }

  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  revalidatePath(`/organiser/event/${tournamentId}/dashboard`);
  return { success: true };
}
