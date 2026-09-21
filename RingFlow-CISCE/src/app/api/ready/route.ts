import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Readiness: "has this instance finished starting up?"
 * Compose gates on the `migrate` one-shot job before the app starts, so by
 * the time this route exists the schema is current; this only confirms the
 * process can reach the database.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ready" }, { status: 200 });
  } catch {
    return Response.json({ status: "not-ready" }, { status: 503 });
  }
}
