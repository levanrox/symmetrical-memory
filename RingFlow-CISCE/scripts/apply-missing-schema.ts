import postgres from "postgres";

const sql = postgres(
  process.env.DATABASE_URL || "postgres://event_suite:event_suite@127.0.0.1:5432/ringflow",
  { max: 1 }
);

async function run() {
  console.log("Applying missing columns to PostgreSQL...");
  await sql`
    ALTER TABLE tournaments 
    ADD COLUMN IF NOT EXISTS organiser_code TEXT,
    ADD COLUMN IF NOT EXISTS stager_codes JSONB DEFAULT '[]'::jsonb;
  `;
  await sql`
    UPDATE tournaments 
    SET organiser_code = upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6))
    WHERE organiser_code IS NULL OR organiser_code = '';
  `;
  await sql`
    ALTER TABLE category_assignments 
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS total_paused_seconds INTEGER NOT NULL DEFAULT 0;
  `;
  await sql`
    ALTER TABLE rings 
    ADD COLUMN IF NOT EXISTS timer_status TEXT NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS timer_paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS timer_accumulated_seconds INTEGER NOT NULL DEFAULT 0;
  `;
  console.log("✅ Columns successfully added to PostgreSQL!");

  const tRows = await sql`SELECT id, name, organiser_code FROM tournaments`;
  console.log("Current tournaments & organiser codes:");
  for (const t of tRows) {
    console.log(` - [${t.name}] ID: ${t.id} => Organiser Code: ${t.organiser_code}`);
  }

  await sql.end();
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
