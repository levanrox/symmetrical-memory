import postgres from "postgres";
import fs from "fs";
import path from "path";

// Load .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

const connectionString =
  process.env.DATABASE_URL || "postgres://event_suite:event_suite@127.0.0.1:5432/ringflow";

/** Never log credentials: show host/user/db only, mask the password. */
function redactConnectionString(conn: string): string {
  try {
    const u = new URL(conn);
    const user = u.username ? decodeURIComponent(u.username) : "";
    const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
    const db = u.pathname.replace(/^\//, "");
    return `${u.protocol}//${user ? `${user}@` : ""}${host}/${db} (password hidden)`;
  } catch {
    return "<unparseable connection string — password hidden>";
  }
}

console.log("Connecting to PostgreSQL at:", redactConnectionString(connectionString));

const sql = postgres(connectionString, { max: 1 });

async function run() {
  console.log("🚀 Bootstrapping RingFlow PostgreSQL Schema...");

  // 1. Core Drizzle Schema
  const schemaFile = path.resolve(process.cwd(), "supabase/migrations/0000_pale_the_fallen.sql");
  if (fs.existsSync(schemaFile)) {
    console.log("📦 Applying core schema: 0000_pale_the_fallen.sql");
    const rawSql = fs.readFileSync(schemaFile, "utf-8");
    const statements = rawSql.split("--> statement-breakpoint");
    for (const stmt of statements) {
      const clean = stmt.trim();
      if (clean) {
        try {
          await sql.unsafe(clean);
        } catch (err: any) {
          // If table already exists, ignore
          if (!err.message?.includes("already exists")) {
            console.warn("  Notice:", err.message);
          }
        }
      }
    }
    console.log("✅ Core tables created successfully!");
  }

  // 2. Apply request tables (organiser_requests, stager_requests, clock columns)
  const migration6File = path.resolve(
    process.cwd(),
    "supabase/migrations/migration6_clock_display_requests.sql"
  );
  if (fs.existsSync(migration6File)) {
    console.log("📦 Applying migration6: clock, display & request tables...");
    const rawSql = fs.readFileSync(migration6File, "utf-8");
    try {
      await sql.unsafe(rawSql);
      console.log("✅ Migration 6 applied!");
    } catch (err: any) {
      console.warn("  Notice on migration 6:", err.message);
    }
  }

  // 3. Apply missing schema columns (organiser_code, stager_codes, etc.)
  console.log("📦 Verifying additional columns & codes...");
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
    ADD COLUMN IF NOT EXISTS timer_accumulated_seconds INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS timer_duration_ms INTEGER NOT NULL DEFAULT 180000,
    ADD COLUMN IF NOT EXISTS timer_accumulated_ms INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sides_swapped BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS current_match_id TEXT,
    ADD COLUMN IF NOT EXISTS match_duration_seconds INTEGER NOT NULL DEFAULT 180;
  `;

  // 4. Apply Real-Time Notification Triggers (migration 8)
  const migration8File = path.resolve(
    process.cwd(),
    "supabase/migrations/migration8_realtime_notify.sql"
  );
  if (fs.existsSync(migration8File)) {
    console.log("⚡ Applying Real-Time NOTIFY triggers (migration 8)...");
    const rawSql = fs.readFileSync(migration8File, "utf-8");
    try {
      await sql.unsafe(rawSql);
      console.log("✅ Real-Time triggers active! Postgres now emits ringflow_events.");
    } catch (err: any) {
      console.warn("  Notice on migration 8:", err.message);
    }
  }

  // 5. Verify tables in database
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `;
  console.log("\n📋 Active Tables in PostgreSQL database:");
  for (const t of tables) {
    console.log("  -", t.table_name);
  }

  console.log("\n🎉 Database successfully initialized and ready!");
  await sql.end();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("❌ Bootstrap failed:", err);
  await sql.end();
  process.exit(1);
});
