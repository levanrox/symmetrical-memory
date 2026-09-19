import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { redirect } from "next/navigation";
import { ensureAdminOwnsTournament } from "@/actions/admin";
import CategoriesClient from "@/components/admin/CategoriesClient";
import { db } from "@/db";
import { tournaments as tournamentsTable, categories as categoriesTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { serializeCategory } from "@/lib/serializers";

export default async function AdminCategories({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await ensureAdminOwnsTournament(tournamentId);
  } catch {
    redirect("/admin");
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
  if (!tournament) redirect("/admin");

  const categories = catRows.map(serializeCategory);

  return (
    <>
      <AdminHeader title="Categories" eventName={tournament.name} />
      <CategoriesClient tournamentId={tournamentId} initialCategories={categories} />
    </>
  );
}
