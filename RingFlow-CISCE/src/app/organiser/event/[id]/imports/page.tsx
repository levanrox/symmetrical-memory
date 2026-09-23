import React from "react";
import { redirect } from "next/navigation";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import ImportsClient from "@/components/admin/ImportsClient";
import { ensureOrganiserHasAccessToTournament } from "@/actions/organiser";
import { db } from "@/db";
import { tournaments as tournamentsTable } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function OrganiserImportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;

  try {
    await ensureOrganiserHasAccessToTournament(tournamentId);
  } catch {
    redirect("/");
  }

  const [tournament] = await db
    .select({ name: tournamentsTable.name })
    .from(tournamentsTable)
    .where(eq(tournamentsTable.id, tournamentId))
    .limit(1);
  if (!tournament) redirect("/");

  return (
    <>
      <OrganiserHeader title="Imports" eventName={tournament.name} />
      <ImportsClient tournamentId={tournamentId} />
    </>
  );
}
