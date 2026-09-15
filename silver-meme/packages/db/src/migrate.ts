import type { Pool } from 'pg';
import { MIGRATIONS } from './migrations';

/**
 * Applies every migration that has not been applied yet, each in its own
 * transaction, recording the outcome in `schema_migrations`.
 *
 * Returns the ids it applied, which is what a caller wants to log — an empty
 * array means "already up to date".
 */
export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
  const alreadyApplied = new Set(applied.rows.map((row) => row.id));

  const newlyApplied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (alreadyApplied.has(migration.id)) continue;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      await client.query('COMMIT');
      newlyApplied.push(migration.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

/**
 * Drops and recreates the schema. For tests only — never call this in anger.
 *
 * `IF EXISTS` / `IF NOT EXISTS` so a previous failed run that left the schema
 * missing cannot wedge every subsequent run.
 */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA IF NOT EXISTS public');
}

/**
 * Empties every table. For tests only.
 *
 * Deliberately `DELETE` rather than `TRUNCATE`: truncating a relation fsyncs
 * its file, which measured ~7 seconds across the schema on the reference box,
 * whereas ordered deletes are a few milliseconds. `schema_migrations` is left
 * alone so the next `migrate()` does not try to re-create existing objects.
 *
 * Order is children-first; add new tables here when they gain foreign keys.
 */
const CLEAR_ORDER = [
  'match_events',
  'match_slots',
  'matches',
  'draw_versions',
  'draws',
  'tatami_assignments',
  'devices',
  'audit_logs',
  'registrations',
  'categories',
  'tatamis',
  'events',
  'athletes',
  'organizations',
  'users',
] as const;

export async function clearAll(pool: Pool): Promise<void> {
  for (const table of CLEAR_ORDER) {
    await pool.query(`DELETE FROM "${table}"`);
  }
}
