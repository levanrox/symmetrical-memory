import React from "react";
import ModeratorQueueClient from "@/components/moderator/ModeratorQueueClient";
import { db } from "@/db";
import {
  categoryAssignments as categoryAssignmentsTable,
  categories as categoriesTable,
} from "@/db/schema";
import { eq, inArray, and, asc } from "drizzle-orm";
import { serializeCategoryAssignment } from "@/lib/serializers";

export default async function ModeratorQueuePage({ params }: { params: Promise<{ id?: string; ringId: string }> }) {
  const { ringId } = await params;

  const rawAssignments = await db
    .select()
    .from(categoryAssignmentsTable)
    .where(
      and(
        eq(categoryAssignmentsTable.ringId, ringId),
        inArray(categoryAssignmentsTable.status, ["pending", "running", "paused"])
      )
    )
    .orderBy(asc(categoryAssignmentsTable.queueOrder));

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

  return <ModeratorQueueClient ringId={ringId} initialAssignments={assignments} />;
}
