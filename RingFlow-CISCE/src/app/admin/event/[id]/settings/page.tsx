import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { ensureAdminOwnsTournament } from "@/actions/admin";
import SettingsClient from "@/components/admin/SettingsClient";

export default async function AdminSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await ensureAdminOwnsTournament(tournamentId);
  } catch {
    redirect("/admin");
  }

  const supabase = await createClient();

  const [
    { data: tournament },
    { data: organiserRequests }
  ] = await Promise.all([
    supabase.from("tournaments").select("*").eq("id", tournamentId).single(),
    supabase
      .from("organiser_requests")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: false }),
  ]);

  if (!tournament) redirect("/admin");

  return (
    <>
      <AdminHeader title="Settings" eventName={tournament.name} />
      <SettingsClient 
        tournament={tournament} 
        initialOrganiserRequests={organiserRequests || []} 
      />
    </>
  );
}
