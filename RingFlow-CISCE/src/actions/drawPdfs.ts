"use server";

import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { staffRolesForTournament } from "@/lib/staffAccess";
import { buildAllCategoryDrawPdfs, buildCategoryDrawPdf } from "@/lib/pdf/drawSheetFiles";

/**
 * Draw sheets are confidential official tournament documents.
 * Per strict tournament security rules, ONLY the tournament Admin is allowed to download them.
 */
async function assertAdminForCategory(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  const roles = await staffRolesForTournament(cat.tournamentId);
  if (!roles.includes("admin")) {
    throw new Error("Access denied: Only tournament administrators can download draw sheets.");
  }
}

/** One category's official draw sheet, base64-encoded. STRICTLY ADMIN ONLY. */
export async function downloadCategoryDrawPdf(categoryId: string) {
  await assertAdminForCategory(categoryId);
  return buildCategoryDrawPdf(categoryId);
}

/** Every category's draw sheet in the tournament, zipped. STRICTLY ADMIN ONLY. */
export async function downloadAllCategoryDrawPdfs(tournamentId: string) {
  const roles = await staffRolesForTournament(tournamentId);
  if (!roles.includes("admin")) {
    throw new Error("Access denied: Only tournament administrators can download draw sheets.");
  }

  return buildAllCategoryDrawPdfs(tournamentId);
}
