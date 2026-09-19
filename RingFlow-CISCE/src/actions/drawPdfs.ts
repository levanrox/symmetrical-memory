"use server";

import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { staffRolesForTournament } from "@/lib/staffAccess";
import { buildAllCategoryDrawPdfs, buildCategoryDrawPdf } from "@/lib/pdf/drawSheetFiles";

/**
 * Draw sheets are working documents for the people running the floor — the
 * stager calls athletes in from them, the moderator runs the bouts. They are
 * not a public download: that is what the admin's public-draws switch is for.
 */
async function assertStaffForCategory(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  const roles = await staffRolesForTournament(cat.tournamentId);
  if (roles.length === 0) {
    throw new Error("Not authorized to download draw sheets for this event");
  }
}

/** One category's official draw sheet, base64-encoded. Staff only. */
export async function downloadCategoryDrawPdf(categoryId: string) {
  await assertStaffForCategory(categoryId);
  return buildCategoryDrawPdf(categoryId);
}

/** Every category's draw sheet in the tournament, zipped. Staff only. */
export async function downloadAllCategoryDrawPdfs(tournamentId: string) {
  const roles = await staffRolesForTournament(tournamentId);
  if (roles.length === 0) {
    throw new Error("Not authorized to download draw sheets for this event");
  }

  return buildAllCategoryDrawPdfs(tournamentId);
}
