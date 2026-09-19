import React from "react";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { redirect } from "next/navigation";
import CategoriesClient from "@/components/admin/CategoriesClient";
import { ensureOrganiserHasAccessToTournament } from "@/actions/organiser";
import { db } from "@/db";
import { tournaments as tournamentsTable, categories as categoriesTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { serializeCategory } from "@/lib/serializers";

export default async function OrganiserCategoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;

  try {
    await ensureOrganiserHasAccessToTournament(tournamentId);
  } catch {
    redirect("/");
  }

  const [tournamentRows, catRows] = await Promise.all([
    db
      .select({ name: tournamentsTable.name })
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.tournamentId, tournamentId))
      .orderBy(desc(categoriesTable.createdAt)),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) redirect("/");

  return (
    <>
      <OrganiserHeader title="Categories" eventName={tournament.name} />
      <CategoriesClient 
        tournamentId={tournamentId} 
        initialCategories={catRows.map(serializeCategory)} 
        readOnly={true} 
      />
    </>
  );
}
