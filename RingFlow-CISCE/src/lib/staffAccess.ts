import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { moderatorRequests, rings, stagerRequests } from "@/db/schema";
import { ensureAdmin } from "@/actions/admin";
import { ensureOrganiser } from "@/actions/organiser";

export type StaffRole = "admin" | "organiser" | "moderator" | "stager";

/**
 * Who counts as staff, and for which event.
 *
 * Draws, draw-sheet PDFs and draw generation are internal working documents.
 * Everyone running the floor needs them (a stager calls athletes in from the
 * draw; a moderator runs the bouts), and nobody outside does — which is what the
 * admin's "show draws to the public" switch is for.
 *
 * This lives in a plain module rather than a "use server" file so it can be
 * shared by every action that needs it without becoming a callable endpoint.
 */

/** Staff identities recognised for a bracket or draw sheet, cheapest checks first. */
export async function staffRolesForTournament(tournamentId: string): Promise<StaffRole[]> {
  const cookieStore = await cookies();
  const roles: StaffRole[] = [];

  if (cookieStore.get("admin_session")?.value || cookieStore.get("admin_dev_id")?.value) {
    try {
      await ensureAdmin();
      roles.push("admin");
      return roles; // admin sees every event
    } catch {}
  }

  if (cookieStore.get("org_token")?.value) {
    try {
      await ensureOrganiser();
      roles.push("organiser");
    } catch {}
  }

  const stagerToken = cookieStore.get("stager_token")?.value;
  if (stagerToken) {
    const [request] = await db
      .select({ id: stagerRequests.id, expiresAt: stagerRequests.expiresAt })
      .from(stagerRequests)
      .where(
        and(
          eq(stagerRequests.sessionToken, stagerToken),
          eq(stagerRequests.tournamentId, tournamentId),
          eq(stagerRequests.status, "approved")
        )
      )
      .limit(1);

    if (request && (!request.expiresAt || request.expiresAt.getTime() > Date.now())) {
      roles.push("stager");
    }
  }

  // A moderator holds one tatami; that tatami decides which event they are staff for.
  const modToken = cookieStore.get("mod_token")?.value;
  if (modToken) {
    const [row] = await db
      .select({ id: moderatorRequests.id })
      .from(moderatorRequests)
      .innerJoin(rings, eq(rings.id, moderatorRequests.ringId))
      .where(
        and(
          eq(moderatorRequests.sessionToken, modToken),
          eq(moderatorRequests.status, "approved"),
          eq(rings.tournamentId, tournamentId)
        )
      )
      .limit(1);

    if (row) roles.push("moderator");
  }

  return roles;
}

/** Staff for at least one event — used where the caller's own scope is checked separately. */
export async function isAnyStaff(): Promise<boolean> {
  const cookieStore = await cookies();

  if (cookieStore.get("admin_session")?.value || cookieStore.get("admin_dev_id")?.value) {
    try {
      await ensureAdmin();
      return true;
    } catch {}
  }

  if (cookieStore.get("org_token")?.value) {
    try {
      await ensureOrganiser();
      return true;
    } catch {}
  }

  const stagerToken = cookieStore.get("stager_token")?.value;
  if (stagerToken) {
    const [row] = await db
      .select({ id: stagerRequests.id })
      .from(stagerRequests)
      .where(
        and(
          eq(stagerRequests.sessionToken, stagerToken),
          eq(stagerRequests.status, "approved")
        )
      )
      .limit(1);
    if (row) return true;
  }

  const modToken = cookieStore.get("mod_token")?.value;
  if (modToken) {
    const [row] = await db
      .select({ id: moderatorRequests.id })
      .from(moderatorRequests)
      .where(
        and(
          eq(moderatorRequests.sessionToken, modToken),
          eq(moderatorRequests.status, "approved")
        )
      )
      .limit(1);
    if (row) return true;
  }

  return false;
}
