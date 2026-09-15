import postgres from "postgres";

const sql = postgres(
  process.env.DATABASE_URL || "postgres://event_suite:event_suite@127.0.0.1:5432/ringflow",
  { max: 1 }
);

async function run() {
  console.log("Applying OVR columns to PostgreSQL...");
  await sql`
    ALTER TABLE matches 
    ADD COLUMN IF NOT EXISTS aka_score INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ao_score INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aka_penalties INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ao_penalties INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS senshu TEXT,
    ADD COLUMN IF NOT EXISTS winner_side TEXT,
    ADD COLUMN IF NOT EXISTS decision_method TEXT;
  `;

  await sql`
    ALTER TABLE rings
    ADD COLUMN IF NOT EXISTS current_match_id TEXT,
    ADD COLUMN IF NOT EXISTS match_duration_seconds INTEGER NOT NULL DEFAULT 180;
  `;

  await sql`
    ALTER TABLE tournaments
    ADD COLUMN IF NOT EXISTS show_public_draws BOOLEAN DEFAULT TRUE;
  `;

  console.log("✅ OVR columns added successfully!");
  await sql.end();
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
