import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { redirect } from "next/navigation";
import { ensureAdminOwnsTournament } from "@/actions/admin";
import CategoriesClient from "@/components/admin/CategoriesClient";
import { db } from "@/db";
import { tournaments as tournamentsTable, categories as categoriesTable, tournamentCategoryDefinitions as definitionsTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { serializeCategory } from "@/lib/serializers";
import { isKataCategoryName } from "@/lib/draws/kataSettings";

export default async function AdminCategories({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await ensureAdminOwnsTournament(tournamentId);
  } catch {
    redirect("/admin");
  }

  const [tournamentRows, catRows, defRows] = await Promise.all([
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
    db
      .select({
        categoryName: definitionsTable.categoryName,
        eventType: definitionsTable.eventType,
      })
      .from(definitionsTable)
      .where(eq(definitionsTable.tournamentId, tournamentId)),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) redirect("/admin");

  // is_kata uses the same detection the draw engine uses, so the kata draw
  // settings UI appears for exactly the categories the engine treats as kata.
  const categories = catRows.map((c) => ({
    ...serializeCategory(c),
    is_kata: isKataCategoryName(c.name, defRows),
  }));

  return (
    <>
      <AdminHeader title="Categories" eventName={tournament.name} />
      <CategoriesClient tournamentId={tournamentId} initialCategories={categories} />
    </>
  );
}
