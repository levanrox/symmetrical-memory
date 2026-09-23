import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureOrganiserHasAccessToTournament } from "@/actions/organiser";
import { athleteTemplateCsv, categoryTemplateCsv } from "@/lib/imports/validate";

/**
 * GET /api/imports/template?kind=categories|athletes&tournamentId=<uuid>
 * Downloads the CSV template (headers + one example row) for the P6 imports.
 * The athlete template lists the tournament's existing categories so the
 * organiser can copy exact names/codes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const tournamentId = url.searchParams.get("tournamentId");

  if (!tournamentId) {
    return NextResponse.json({ error: "tournamentId is required" }, { status: 400 });
  }
  if (kind !== "categories" && kind !== "athletes") {
    return NextResponse.json(
      { error: "kind must be 'categories' or 'athletes'" },
      { status: 400 }
    );
  }

  try {
    await ensureOrganiserHasAccessToTournament(tournamentId);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let csv: string;
  if (kind === "categories") {
    csv = categoryTemplateCsv();
  } else {
    const cats = await db
      .select({ name: categories.name, code: categories.code })
      .from(categories)
      .where(eq(categories.tournamentId, tournamentId));
    csv = athleteTemplateCsv(cats.map((c) => ({ name: c.name, code: c.code })));
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ringflow-${kind}-template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
