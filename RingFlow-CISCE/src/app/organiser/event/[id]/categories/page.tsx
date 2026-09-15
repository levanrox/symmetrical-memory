import React from "react";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import CategoriesClient from "@/components/admin/CategoriesClient";
import { ensureOrganiserHasAccessToTournament } from "@/actions/organiser";

export default async function OrganiserCategoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;

  try {
    await ensureOrganiserHasAccessToTournament(tournamentId);
  } catch {
    redirect("/");
  }

  const supabase = await createClient();

  const [
    { data: tournament },
    { data: categories }
  ] = await Promise.all([
    supabase.from("tournaments").select("name").eq("id", tournamentId).single(),
    supabase.from("categories").select("*").eq("tournament_id", tournamentId).order("created_at", { ascending: false })
  ]);

  if (!tournament) redirect("/");

  return (
    <>
      <OrganiserHeader title="Categories" eventName={tournament.name} />
      <CategoriesClient 
        tournamentId={tournamentId} 
        initialCategories={categories || []} 
        readOnly={true} 
      />
    </>
  );
}
