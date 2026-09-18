import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rings, tournaments } from "@/db/schema";
import { validateModeratorSession } from "@/actions/moderator";
import { ensureAdmin } from "@/actions/admin";

/**
 * Who may open the arena screen:
 *  1. the moderator who holds this tatami,
 *  2. a signed-in admin/organiser running the floor,
 *  3. anyone, if the admin explicitly enabled the public TV screen for this event.
 * The route is never linked from public pages unless that switch is on.
 */
export default async function ScoreboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ringId: string }>;
}) {
  const { ringId } = await params;
  const cookieStore = await cookies();

  const token = cookieStore.get("mod_token")?.value;
  if (token) {
    const session = await validateModeratorSession(ringId, token);
    if (session) return <>{children}</>;
  }

  if (cookieStore.get("admin_session")?.value || cookieStore.get("admin_dev_id")?.value) {
    try {
      await ensureAdmin();
      return <>{children}</>;
    } catch {}
  }

  const [row] = await db
    .select({ showPublicScoreboard: tournaments.showPublicScoreboard })
    .from(rings)
    .innerJoin(tournaments, eq(tournaments.id, rings.tournamentId))
    .where(eq(rings.id, ringId));

  if (row?.showPublicScoreboard) return <>{children}</>;

  redirect("/login/mod");
}
