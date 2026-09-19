import postgres from "postgres";

const url = process.env.DATABASE_URL || "postgres://event_suite:event_suite@172.24.3.24:5432/ringflow";
console.log("Connecting to:", url);

const sql = postgres(url);

async function main() {
  try {
    const res = await sql`SELECT 1 as connected, current_database(), current_user`;
    console.log("✅ Successfully connected to PostgreSQL:", res);
  } catch (err: any) {
    console.error("❌ Connection error:", err);
  } finally {
    await sql.end();
    process.exit(0);
  }
}

main();
