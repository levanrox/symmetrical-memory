import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { redirect } from "next/navigation";
import { ensureAdminOwnsTournament } from "@/actions/admin";
import RingsClient from "@/components/admin/RingsClient";
import { db } from "@/db";
import { tournaments, rings, moderatorRequests } from "@/db/schema";
import { eq, and, inArray, desc, asc } from "drizzle-orm";

export default async function AdminRings({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await ensureAdminOwnsTournament(tournamentId);
  } catch (err) {
    console.error("ensureAdminOwnsTournament failed on rings page:", err);
    redirect("/admin");
  }

  const [tournament] = await db
    .select({ name: tournaments.name })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    console.warn(`Tournament ${tournamentId} not found, redirecting to /admin`);
    redirect("/admin");
  }

  const ringList = await db
    .select()
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId))
    .orderBy(asc(rings.ringOrder));

  const ringIds = ringList.map((r) => r.id);
  let modRequests: any[] = [];
  if (ringIds.length > 0) {
    try {
      const reqs = await db
        .select()
        .from(moderatorRequests)
        .where(
          and(
            inArray(moderatorRequests.ringId, ringIds),
            inArray(moderatorRequests.status, ["pending", "approved"])
          )
        )
        .orderBy(desc(moderatorRequests.createdAt));

      modRequests = reqs.map((m) => ({
        id: m.id,
        ring_id: m.ringId,
        moderator_name: m.moderatorName || "Moderator",
        status: m.status,
        device_info: m.deviceInfo,
        created_at: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
      }));
    } catch (err) {
      console.warn("Could not fetch moderatorRequests:", err);
    }
  }

  return (
    <>
      <AdminHeader title="Access" eventName={tournament.name} />
      <RingsClient
        tournamentId={tournamentId}
        initialRings={ringList.map((r) => ({
          id: r.id,
          name: r.name,
          ring_order: r.ringOrder,
          access_code: r.accessCode,
        }))}
        initialModRequests={modRequests}
        initialStagerRequests={[]}
        initialStagerCodes={[]}
      />
    </>
  );
}
