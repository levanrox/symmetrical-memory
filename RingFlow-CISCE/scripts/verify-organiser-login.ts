/**
 * Reproduces the organiser login path at the database layer — the exact layer
 * that used to fail with "Failed to submit access request" because
 * public.organiser_requests was never created.
 *
 * Run: npx tsx scripts/verify-organiser-login.ts
 */
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../src/db";
import { organiserRequests, stagerRequests, tournaments } from "../src/db/schema";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function tableExists(name: string) {
  const result = await db.execute(
    sql`select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = ${name}) as present`
  );
  const rows = result as unknown as { present: boolean }[];
  return Boolean(rows[0]?.present);
}

async function main() {
  console.log("\n── Request tables ──────────────────────────────────────────────");

  const hasOrganiserRequests = await tableExists("organiser_requests");
  const hasStagerRequests = await tableExists("stager_requests");
  check("public.organiser_requests exists", hasOrganiserRequests);
  check("public.stager_requests exists", hasStagerRequests);

  if (!hasOrganiserRequests) {
    console.log("\nThe table this flow depends on is missing. Run migration 6 or `npm run db:push`.\n");
    process.exit(1);
  }

  console.log("\n── Access code lookup ──────────────────────────────────────────");

  const [tournament] = await db
    .select({ id: tournaments.id, name: tournaments.name, organiserCode: tournaments.organiserCode })
    .from(tournaments)
    .where(and(isNotNull(tournaments.organiserCode), ne(tournaments.organiserCode, "")))
    .limit(1);

  check("at least one tournament has an organiser code", Boolean(tournament?.organiserCode));

  if (!tournament?.organiserCode) {
    console.log("\nNo tournament has an organiser code. Generate one in Event Settings → Organiser.\n");
    process.exit(1);
  }

  console.log(`  using "${tournament.name}" with code ${tournament.organiserCode}`);

  const lowerCaseCode = tournament.organiserCode.toLowerCase();
  const [exact] = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(sql`upper(${tournaments.organiserCode}) = ${lowerCaseCode.toUpperCase()}`)
    .limit(1);
  check("lookup matches a code typed in lower case", exact?.id === tournament.id);

  console.log("\n── Request lifecycle ───────────────────────────────────────────");

  let requestId: string | null = null;
  try {
    const [created] = await db
      .insert(organiserRequests)
      .values({
        tournamentId: tournament.id,
        accessCodeUsed: tournament.organiserCode,
        status: "pending",
        organiserName: "Verification Script",
        deviceInfo: { source: "verify-organiser-login" },
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      })
      .returning({ id: organiserRequests.id });

    requestId = created.id;
    check("a pending request can be created", Boolean(created.id));
  } catch (err: any) {
    check("a pending request can be created", false, err?.message);
  }

  if (requestId) {
    const [pending] = await db
      .select({ status: organiserRequests.status })
      .from(organiserRequests)
      .where(eq(organiserRequests.id, requestId));
    check("the request reads back as pending", pending?.status === "pending");

    const sessionToken = crypto.randomUUID();
    await db
      .update(organiserRequests)
      .set({ status: "approved", sessionToken })
      .where(eq(organiserRequests.id, requestId));

    const [approved] = await db
      .select({ status: organiserRequests.status, sessionToken: organiserRequests.sessionToken })
      .from(organiserRequests)
      .where(eq(organiserRequests.id, requestId));
    check("approval sticks", approved?.status === "approved" && approved.sessionToken === sessionToken);

    const [resolved] = await db
      .select({ id: organiserRequests.id, tournamentId: organiserRequests.tournamentId })
      .from(organiserRequests)
      .where(eq(organiserRequests.sessionToken, sessionToken));
    check("the session token resolves back to the tournament", resolved?.tournamentId === tournament.id);

    await db.delete(organiserRequests).where(eq(organiserRequests.id, requestId));
    const [gone] = await db
      .select({ id: organiserRequests.id })
      .from(organiserRequests)
      .where(eq(organiserRequests.id, requestId));
    check("cleanup removed the test request", !gone);
  }

  // stager_requests is the same shape and had the same defect.
  const stagerWritable = await (async () => {
    try {
      const [row] = await db
        .insert(stagerRequests)
        .values({
          tournamentId: tournament.id,
          accessCodeUsed: "VERIFY",
          status: "pending",
          stagerName: "Verification Script",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .returning({ id: stagerRequests.id });
      await db.delete(stagerRequests).where(eq(stagerRequests.id, row.id));
      return true;
    } catch (err: any) {
      console.log(`  (stager error: ${err?.message})`);
      return false;
    }
  })();
  check("a stager request can be created and removed", stagerWritable);

  console.log(
    failures === 0
      ? "\nAll organiser checks passed.\n"
      : `\n${failures} organiser check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-organiser-login crashed:", err);
  process.exit(1);
});
