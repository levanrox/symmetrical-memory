import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL || "postgres://event_suite:event_suite@172.24.3.24:5432/ringflow";

const sql = postgres(connectionString, { max: 1 });

async function run() {
  await sql`
    CREATE TABLE IF NOT EXISTS admins (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  console.log("✅ admins table verified");

  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      age_bracket TEXT,
      weight_class TEXT,
      athletes_count INT NOT NULL DEFAULT 0,
      expected_matches INT NOT NULL DEFAULT 0,
      has_full_roster BOOLEAN NOT NULL DEFAULT FALSE,
      belt TEXT,
      age_min INT,
      age_max INT,
      sex TEXT,
      day TEXT,
      doc_url TEXT,
      bronze_medals INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  console.log("✅ categories table verified");

  await sql`
    CREATE TABLE IF NOT EXISTS athletes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
      tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      chest_number TEXT,
      belt TEXT,
      age TEXT,
      sex TEXT,
      day TEXT,
      dojo TEXT,
      school TEXT,
      school_code TEXT,
      sports_id TEXT,
      weight NUMERIC(5,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  console.log("✅ athletes table verified");

  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `;
  console.log("\nAll Tables now in DB:");
  for (const t of tables) {
    console.log(" -", t.table_name);
  }

  await sql.end();
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
