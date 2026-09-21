#!/usr/bin/env node
/**
 * Versioned database migration runner.
 *
 * Applies the drizzle journal in supabase/migrations/ (0000 baseline +
 * follow-up diffs) and then the idempotent realtime NOTIFY trigger
 * (migration8_realtime_notify.sql) that the realtime bridge depends on.
 *
 * Usage:
 *   node scripts/migrate-db.mjs            # uses DATABASE_DIRECT_URL || DATABASE_URL
 *
 * It is also the entrypoint of the `migrate` one-shot service in
 * docker-compose.yml, which gates app startup (service_completed_successfully).
 *
 * Safety:
 * - Targets FRESH databases. If tables exist but the drizzle migrations
 *   ledger is absent (i.e. the DB was created with `db:push`), it refuses to
 *   run and tells you how to baseline manually.
 * - Each journal entry runs inside its own transaction; any failure aborts
 *   the whole run with a non-zero exit code.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../supabase/migrations");
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta/_journal.json");
const LEDGER_TABLE = "__drizzle_migrations";
const SENTINEL_TABLE = "admins"; // exists in every RingFlow database

const connectionString =
  process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("migrate-db: DATABASE_DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

function fail(msg) {
  console.error(`migrate-db: ${msg}`);
  process.exit(1);
}

async function tableExists(name) {
  const rows = await sql`
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = ${name}
    limit 1`;
  return rows.length > 0;
}

async function main() {
  if (!existsSync(JOURNAL_PATH)) fail(`journal not found at ${JOURNAL_PATH}`);
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  const hasSentinel = await tableExists(SENTINEL_TABLE);
  const hasLedger = await tableExists(LEDGER_TABLE);

  if (hasSentinel && !hasLedger) {
    fail(
      "this database has tables but no migration ledger — it was probably " +
        "created with `db:push`. migrate-db only targets fresh databases.\n" +
        "Options: (a) start from an empty database and re-run, or (b) baseline " +
        "manually: create the ledger and insert one row per already-applied " +
        "journal entry, e.g.\n" +
        "  create table __drizzle_migrations (id serial primary key, hash text not null, created_at bigint);\n" +
        "  insert into __drizzle_migrations (hash, created_at) values ('0000_pale_the_fallen', ...), ..."
    );
  }

  if (!hasLedger) {
    await sql.unsafe(`
      create table ${LEDGER_TABLE} (
        id serial primary key,
        hash text not null,
        created_at bigint
      )`);
    console.log("migrate-db: created migration ledger");
  }

  const appliedRows = await sql.unsafe(`select hash from ${LEDGER_TABLE}`);
  const applied = new Set(appliedRows.map((r) => r.hash));

  for (const entry of entries) {
    if (applied.has(entry.tag)) {
      console.log(`migrate-db: already applied: ${entry.tag}`);
      continue;
    }
    const file = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!existsSync(file)) fail(`migration file missing: ${file}`);
    console.log(`migrate-db: applying ${entry.tag} ...`);
    const statements = readFileSync(file, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(statements);
      // Parameterized: the journal tag comes from a repo JSON file, but
      // interpolating it into SQL would still be an injection vector if the
      // journal were ever tampered with. The table name is a module constant
      // (escaped as an identifier); the values are bound parameters.
      await tx`insert into ${tx(LEDGER_TABLE)} (hash, created_at) values (${entry.tag}, ${Date.now()})`;
    });
    console.log(`migrate-db: applied ${entry.tag}`);
  }

  // Hand-written trigger migration: idempotent by design (CREATE OR REPLACE +
  // DROP IF EXISTS), so it is safe to re-run on every deploy.
  const triggers = join(MIGRATIONS_DIR, "migration8_realtime_notify.sql");
  if (existsSync(triggers)) {
    console.log("migrate-db: applying migration8_realtime_notify.sql ...");
    await sql.unsafe(readFileSync(triggers, "utf8"));
    console.log("migrate-db: realtime triggers up to date");
  }

  // Sanity check
  const ok = await tableExists(SENTINEL_TABLE);
  if (!ok) fail("post-migration sanity check failed: admins table missing");

  console.log("migrate-db: done — database is at the latest version");
  await sql.end();
}

main().catch(async (err) => {
  console.error("migrate-db: FAILED:", err?.message || err);
  try {
    await sql.end();
  } catch {}
  process.exit(1);
});
