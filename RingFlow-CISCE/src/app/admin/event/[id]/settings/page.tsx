import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { redirect } from "next/navigation";
import { ensureAdminOwnsTournament } from "@/actions/admin";
import SettingsClient from "@/components/admin/SettingsClient";
import { getJudgeAccessConfig } from "@/actions/judgeAccess";
import { db } from "@/db";
import { tournaments as tournamentsTable, organiserRequests as organiserRequestsTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { serializeTournament, serializeOrganiserRequest } from "@/lib/serializers";

export default async function AdminSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await ensureAdminOwnsTournament(tournamentId);
  } catch {
    redirect("/admin");
  }

  const [tournamentRows, requestRows, judgeAccess] = await Promise.all([
    db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(organiserRequestsTable)
      .where(eq(organiserRequestsTable.tournamentId, tournamentId))
      .orderBy(desc(organiserRequestsTable.createdAt)),
    // Judge access is a server-wide setting; read failures must not break settings.
    getJudgeAccessConfig().catch(() => null),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) redirect("/admin");

  return (
    <>
      <AdminHeader title="Settings" eventName={tournament.name} />
      <SettingsClient 
        tournament={serializeTournament(tournament)} 
        initialOrganiserRequests={requestRows.map((r) => serializeOrganiserRequest(r)!)}
        judgeAccess={judgeAccess}
      />
    </>
  );
}
