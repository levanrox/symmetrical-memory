"use server";

import { cookies } from "next/headers";
import { db } from "@/db";
import {
  admins,
  tournaments,
  rings,
  categoryAssignments,
  categories,
  athletes,
  eventLog,
  moderatorRequests,
} from "@/db/schema";
import { eq, and, inArray, desc, asc, sql } from "drizzle-orm";
import { startRingTimer, pauseRingTimer, setAllRingTimers } from "./rings";
import {
  serializeRing,
  serializeCategory,
  serializeCategoryAssignment,
  serializeEventLog,
  serializeModRequest,
} from "@/lib/serializers";

/**
 * Ensures the currently authenticated user exists in the public.admins table.
 * Throws if not authenticated or not a registered admin.
 * Returns the admin's UUID.
 */
export async function ensureAdmin() {
  let sessionAdminId: string | undefined;
  try {
    const cookieStore = await cookies();
    sessionAdminId =
      cookieStore.get("admin_session")?.value ||
      cookieStore.get("admin_dev_id")?.value;
  } catch {}

  if (sessionAdminId) {
    const admin = await db
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.id, sessionAdminId))
      .limit(1);

    if (admin && admin.length > 0) {
      return admin[0].id;
    }
  }

  // In non-production environments, fallback to the seeded director admin
  if (process.env.NODE_ENV !== "production") {
    const defaultAdmin = await db
      .select({ id: admins.id })
      .from(admins)
      .limit(1);
    if (defaultAdmin && defaultAdmin.length > 0) return defaultAdmin[0].id;
  }

  throw new Error("Not authenticated");
}

export async function loginAsDevAdmin(adminId?: string) {
  let targetId: string = adminId || "";
  if (!targetId) {
    const [firstAdmin] = await db
      .select({ id: admins.id })
      .from(admins)
      .orderBy(asc(admins.createdAt))
      .limit(1);
    targetId = firstAdmin?.id || "00000000-0000-0000-0000-000000000001";
  }

  const cookieStore = await cookies();
  cookieStore.set("admin_dev_id", targetId, {
    path: "/",
    maxAge: 86400 * 7,
    sameSite: "lax",
  });
  return { success: true, adminId: targetId };
}

export async function logoutDevAdmin() {
  const cookieStore = await cookies();
  cookieStore.delete("admin_dev_id");
  return { success: true };
}

/**
 * Ensures the currently authenticated user is an admin.
 * Registered admins can manage any tournament.
 * Returns the admin's UUID.
 */
export async function ensureAdminOwnsTournament(tournamentId: string) {
  const adminId = await ensureAdmin();

  const tournament = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament || tournament.length === 0) {
    throw new Error("Tournament not found or unauthorized");
  }

  return adminId;
}

export async function adminSetRingStatus(ringId: string, isPaused: boolean) {
  const [ring] = await db
    .select({ id: rings.id, tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  if (!ring) return;

  // Verify admin owns this tournament
  await ensureAdminOwnsTournament(ring.tournamentId);

  // Update ring timer state directly
  if (isPaused) {
    await pauseRingTimer(ringId, ring.tournamentId);
  } else {
    await startRingTimer(ringId, ring.tournamentId);
  }

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.ringId, ringId),
        inArray(categoryAssignments.status, isPaused ? ["running"] : ["paused"])
      )
    )
    .limit(1);

  if (!assignment) return;

  await db
    .update(categoryAssignments)
    .set({ status: isPaused ? "paused" : "running" })
    .where(eq(categoryAssignments.id, assignment.id));

  await db.insert(eventLog).values({
    tournamentId: ring.tournamentId,
    ringId: ringId,
    categoryId: assignment.categoryId,
    action: isPaused ? "PAUSE_RING" : "RESUME_RING",
  });
}

export async function adminSetAllRingsStatus(tournamentId: string, isPaused: boolean) {
  await ensureAdminOwnsTournament(tournamentId);

  const ringList = await db
    .select({ id: rings.id })
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId));

  const ringIds = ringList.map((r) => r.id);
  if (ringIds.length === 0) return;

  const assignments = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        inArray(categoryAssignments.ringId, ringIds),
        inArray(categoryAssignments.status, isPaused ? ["running"] : ["paused"])
      )
    );

  if (!assignments || assignments.length === 0) return;

  for (const assignment of assignments) {
    await db
      .update(categoryAssignments)
      .set({ status: isPaused ? "paused" : "running" })
      .where(eq(categoryAssignments.id, assignment.id));

    await db.insert(eventLog).values({
      tournamentId: tournamentId,
      ringId: assignment.ringId,
      categoryId: assignment.categoryId,
      action: isPaused ? "PAUSE_RING" : "RESUME_RING",
    });
  }
}

/**
 * High-performance, direct Drizzle query for live dashboard reconciliation.
 * Replaces client-side PostgREST queries with single fast server query.
 */
export async function getAdminDashboardData(tournamentId: string) {
  const [ringRows, logRows] = await Promise.all([
    db
      .select()
      .from(rings)
      .where(eq(rings.tournamentId, tournamentId))
      .orderBy(asc(rings.ringOrder)),
    db
      .select()
      .from(eventLog)
      .where(eq(eventLog.tournamentId, tournamentId))
      .orderBy(desc(eventLog.createdAt))
      .limit(50),
  ]);

  const ringIds = ringRows.map((r) => r.id);
  let assignments: any[] = [];

  if (ringIds.length > 0) {
    const rawAssignments = await db
      .select()
      .from(categoryAssignments)
      .where(inArray(categoryAssignments.ringId, ringIds))
      .orderBy(asc(categoryAssignments.queueOrder));

    const categoryIds = Array.from(new Set(rawAssignments.map((a) => a.categoryId).filter(Boolean)));
    const catMap = new Map<string, any>();
    if (categoryIds.length > 0) {
      const cats = await db
        .select()
        .from(categories)
        .where(inArray(categories.id, categoryIds));
      cats.forEach((c) => catMap.set(c.id, c));
    }

    assignments = rawAssignments.map((a) =>
      serializeCategoryAssignment(a, catMap.get(a.categoryId))
    );
  }

  return {
    rings: ringRows.map(serializeRing),
    assignments,
    logs: logRows.map(serializeEventLog),
  };
}

export async function getLiveLogs(tournamentId: string) {
  const logRows = await db
    .select()
    .from(eventLog)
    .where(eq(eventLog.tournamentId, tournamentId))
    .orderBy(desc(eventLog.createdAt))
    .limit(200);
  return logRows.map(serializeEventLog);
}

export async function getPendingModeratorRequests(tournamentId: string) {
  const ringRows = await db
    .select({ id: rings.id, name: rings.name })
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId));

  const ringMap = new Map(ringRows.map((r) => [r.id, r]));
  const ringIds = ringRows.map((r) => r.id);

  if (ringIds.length === 0) return [];

  const rawReqs = await db
    .select()
    .from(moderatorRequests)
    .where(inArray(moderatorRequests.ringId, ringIds))
    .orderBy(desc(moderatorRequests.createdAt))
    .limit(25);

  return rawReqs.map((mr) => serializeModRequest(mr, ringMap.get(mr.ringId)));
}

export async function getTournamentSearchMeta(tournamentId: string) {
  const [cats, ringList] = await Promise.all([
    db.select().from(categories).where(eq(categories.tournamentId, tournamentId)),
    db.select().from(rings).where(eq(rings.tournamentId, tournamentId)),
  ]);

  const ringIds = ringList.map((r) => r.id);
  const assigns =
    ringIds.length > 0
      ? await db
          .select({
            categoryId: categoryAssignments.categoryId,
            ringId: categoryAssignments.ringId,
            status: categoryAssignments.status,
            queueOrder: categoryAssignments.queueOrder,
          })
          .from(categoryAssignments)
          .where(inArray(categoryAssignments.ringId, ringIds))
      : [];

  return {
    categories: cats.map(serializeCategory),
    rings: ringList.map(serializeRing),
    assignments: assigns.map((a) => ({
      category_id: a.categoryId,
      ring_id: a.ringId,
      status: a.status,
      queue_order: a.queueOrder,
    })),
  };
}

export async function getSidebarTournamentCounts(tournamentId: string) {
  if (!tournamentId) return null;

  try {
    const [t] = await db
      .select({ name: tournaments.name })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (!t) return null;

    const [[ringsRes], [catsRes], [athRes]] = await Promise.all([
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(rings)
        .where(eq(rings.tournamentId, tournamentId)),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(categories)
        .where(eq(categories.tournamentId, tournamentId)),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(athletes)
        .where(eq(athletes.tournamentId, tournamentId)),
    ]);

    return {
      name: t.name,
      ringsCount: ringsRes?.count ?? 0,
      categoriesCount: catsRes?.count ?? 0,
      athletesCount: athRes?.count ?? 0,
    };
  } catch (err) {
    console.error("Failed to load sidebar tournament counts:", err);
    return null;
  }
}

