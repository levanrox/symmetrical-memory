"use server";

import { db } from "@/db";
import { categories, draws, tournaments } from "@/db/schema";
import { getCategoryDraw } from "@/actions/draws";
import { generateCategoryDrawPdfBytes } from "@/lib/pdf/drawPdfGenerator";
import { eq } from "drizzle-orm";
import JSZip from "jszip";

/**
 * Generates and returns a single category draw sheet as a base64-encoded PDF
 */
export async function downloadCategoryDrawPdf(categoryId: string) {
  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, cat.tournamentId));

  const drawData = await getCategoryDraw(categoryId);
  if (!drawData) {
    throw new Error("No draw has been generated for this category yet.");
  }

  const pdfBytes = await generateCategoryDrawPdfBytes({
    tournamentName: tournament?.name || "Tournament Championship",
    categoryName: cat.name,
    eventDate: tournament?.eventDate,
    venue: tournament?.venue,
    tournamentSize: drawData.draw.tournamentSize,
    byeCount: drawData.draw.byeCount,
    matches: drawData.matches,
  });

  const base64 = Buffer.from(pdfBytes).toString("base64");
  const filename = `${cat.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}_Draw.pdf`;

  return {
    success: true,
    filename,
    base64,
  };
}

/**
 * Generates all category draw PDFs for the tournament and packages them into a single ZIP file
 */
export async function downloadAllCategoryDrawPdfs(tournamentId: string) {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));

  if (!tournament) throw new Error("Tournament not found");

  const allCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  const zip = new JSZip();
  let includedCount = 0;

  for (const cat of allCats) {
    try {
      const drawData = await getCategoryDraw(cat.id);
      if (!drawData || drawData.matches.length === 0) continue;

      const pdfBytes = await generateCategoryDrawPdfBytes({
        tournamentName: tournament.name,
        categoryName: cat.name,
        eventDate: tournament.eventDate,
        venue: tournament.venue,
        tournamentSize: drawData.draw.tournamentSize,
        byeCount: drawData.draw.byeCount,
        matches: drawData.matches,
      });

      const safeName = `${cat.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}_Draw.pdf`;
      zip.file(safeName, pdfBytes);
      includedCount++;
    } catch (err) {
      console.error(`Error generating PDF for category ${cat.name}:`, err);
    }
  }

  if (includedCount === 0) {
    return {
      success: false,
      error: "No generated draws found in this tournament. Please generate draws first.",
    };
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const base64 = zipBuffer.toString("base64");
  const filename = `${tournament.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}_All_Draws.zip`;

  return {
    success: true,
    filename,
    base64,
    includedCount,
  };
}
