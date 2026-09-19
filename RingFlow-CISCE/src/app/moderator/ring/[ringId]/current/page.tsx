import React from "react";
import ModeratorCurrentClient from "@/components/moderator/ModeratorCurrentClient";
import { db } from "@/db";
import {
  rings as ringsTable,
  categoryAssignments as categoryAssignmentsTable,
  categories as categoriesTable,
  athletes as athletesTable,
} from "@/db/schema";
import { eq, inArray, asc } from "drizzle-orm";
import { serializeCategoryAssignment, serializeAthlete } from "@/lib/serializers";

export default async function ModeratorCurrentPage({ params }: { params: Promise<{ ringId: string }> }) {
  const { ringId } = await params;

  // 1. Fetch ring info to get tournamentId
  const [ring] = await db
    .select({ tournamentId: ringsTable.tournamentId })
    .from(ringsTable)
    .where(eq(ringsTable.id, ringId))
    .limit(1);

  // 2. Fetch category assignments for this ring and tournament athletes in parallel
  const [rawAssignments, rawAthletes] = await Promise.all([
    db
      .select()
      .from(categoryAssignmentsTable)
      .where(
        eq(categoryAssignmentsTable.ringId, ringId)
      )
      .orderBy(asc(categoryAssignmentsTable.queueOrder)),
    ring?.tournamentId
      ? db
          .select()
          .from(athletesTable)
          .where(eq(athletesTable.tournamentId, ring.tournamentId))
      : Promise.resolve([]),
  ]);

  // Fetch categories for assignments
  const categoryIds = Array.from(new Set(rawAssignments.map((a) => a.categoryId).filter(Boolean)));
  const catMap = new Map<string, any>();
  if (categoryIds.length > 0) {
    const cats = await db
      .select()
      .from(categoriesTable)
      .where(inArray(categoriesTable.id, categoryIds));
    cats.forEach((c) => catMap.set(c.id, c));
  }

  const assignments = rawAssignments.map((a) =>
    serializeCategoryAssignment(a, catMap.get(a.categoryId))
  );
  const allAthletes = rawAthletes.map((a) => serializeAthlete(a));

  return (
    <ModeratorCurrentClient 
      ringId={ringId} 
      initialAssignments={assignments} 
      allAthletes={allAthletes} 
    />
  );
}
