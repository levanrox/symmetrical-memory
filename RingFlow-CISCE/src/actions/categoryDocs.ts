"use server";

import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ensureAdminOwnsTournament } from "./admin";
import { categoryDocKey, deleteFile, putFile } from "@/lib/storage";
import { logger } from "@/lib/logger";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a string for fuzzy matching:
 * lowercase, trim, collapse multiple spaces, strip dots.
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\./g, "");
}

/**
 * Given a filename like "U19_F_40 - 44 Kgs.pdf", derive the candidate name:
 * strip the .pdf suffix, trim.
 */
function filenameToName(filename: string): string {
  return filename.replace(/\.pdf$/i, "").trim();
}

/**
 * Find the best matching category by name from a list.
 * First tries exact normalized match; falls back to includes.
 */
function findMatch(
  candidateName: string,
  categories: { id: string; name: string }[]
): { id: string; name: string } | null {
  const norm = normalize(candidateName);
  // Exact normalized match
  const exact = categories.find((c) => normalize(c.name) === norm);
  if (exact) return exact;
  // Contains match (less strict)
  const contains = categories.find(
    (c) => normalize(c.name).includes(norm) || norm.includes(normalize(c.name))
  );
  return contains ?? null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PDFUploadResult = {
  matched: {
    filename: string;
    categoryName: string;
    categoryId: string;
    docUrl: string;
  }[];
  unmatched: string[];
  errors: { filename: string; error: string }[];
};

const MAX_BYTES = 10 * 1024 * 1024;

// ─── Action ──────────────────────────────────────────────────────────────────

/**
 * Bulk-upload category athlete-list PDFs.
 *
 * Each file should be named exactly as the category name + ".pdf"
 * (e.g. "U19_F_40 - 44 Kgs.pdf"). We fuzzy-match by normalized name.
 *
 * Storage goes through src/lib/storage.ts: local files by default (offline
 * LAN friendly — served from /api/files), hosted Supabase Storage only when
 * FILE_STORAGE_BACKEND=supabase. All database access is via Drizzle.
 * Previously uploaded PDFs for the same category are silently replaced.
 */
export async function uploadCategoryPDFs(
  tournamentId: string,
  formData: FormData
): Promise<PDFUploadResult> {
  await ensureAdminOwnsTournament(tournamentId);

  // Fetch all categories for this tournament via Drizzle
  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  // 3. Process each uploaded PDF
  const files = formData.getAll("pdfs") as File[];
  const result: PDFUploadResult = { matched: [], unmatched: [], errors: [] };

  for (const file of files) {
    if (!file || file.size === 0) continue;

    if (file.type && file.type !== "application/pdf") {
      result.errors.push({ filename: file.name, error: "Only PDF files are allowed" });
      continue;
    }
    if (file.size > MAX_BYTES) {
      result.errors.push({ filename: file.name, error: "File must be 10MB or smaller" });
      continue;
    }

    const candidateName = filenameToName(file.name);
    const matchedCategory = findMatch(candidateName, cats);

    if (!matchedCategory) {
      result.unmatched.push(file.name);
      continue;
    }

    try {
      const key = categoryDocKey(tournamentId, matchedCategory.id);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const docUrl = await putFile(key, bytes, "application/pdf");

      await db
        .update(categories)
        .set({ docUrl })
        .where(eq(categories.id, matchedCategory.id));

      result.matched.push({
        filename: file.name,
        categoryName: matchedCategory.name,
        categoryId: matchedCategory.id,
        docUrl,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err, tournamentId, filename: file.name }, "category PDF upload failed");
      result.errors.push({ filename: file.name, error: message });
    }
  }

  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return result;
}

/**
 * Remove a category's PDF (delete from storage + clear doc_url).
 */
export async function removeCategoryPDF(
  tournamentId: string,
  categoryId: string
): Promise<void> {
  await ensureAdminOwnsTournament(tournamentId);

  await deleteFile(categoryDocKey(tournamentId, categoryId));

  await db.update(categories).set({ docUrl: null }).where(eq(categories.id, categoryId));

  revalidatePath(`/admin/event/${tournamentId}/categories`);
}
