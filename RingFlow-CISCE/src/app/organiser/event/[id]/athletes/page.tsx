import React, { Suspense } from "react";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import AthletesClient from "@/components/admin/AthletesClient";
import { ensureOrganiserHasAccessToTournament } from "@/actions/organiser";

export default async function OrganiserAthletesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;

  try {
    await ensureOrganiserHasAccessToTournament(tournamentId);
  } catch {
    redirect("/");
  }

  const supabase = await createClient();

  const [
    { data: tournament },
    { data: athletes },
    { data: categories }
  ] = await Promise.all([
    supabase.from("tournaments").select("name").eq("id", tournamentId).single(),
    supabase.from("athletes").select("*, categories(name)").eq("tournament_id", tournamentId).order("created_at", { ascending: false }),
    supabase.from("categories").select("id, name").eq("tournament_id", tournamentId).order("name", { ascending: true })
  ]);

  if (!tournament) redirect("/");

  const validAthletes = athletes || [];

  return (
    <>
      <OrganiserHeader title="Athletes Roster" eventName={tournament.name} />
      <Suspense fallback={<div className="p-8 text-center text-[#64748B]">Loading roster...</div>}>
        <AthletesClient
          tournamentId={tournamentId}
          initialAthletes={validAthletes}
          categories={categories || []}
          readOnly={true}
        />
      </Suspense>
    </>
  );
}
