import { Pool } from 'pg';

export const DEFAULT_DATABASE_URL = 'postgres://event_suite:event_suite@127.0.0.1:5432/event_suite';
export const TEST_DATABASE_URL =
  'postgres://event_suite:event_suite@127.0.0.1:5432/event_suite_test';

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * A modest pool. The event box serves a handful of rings, and over-allocating
 * connections costs Postgres more than it gains (§12 of the blueprint).
 */
export function createPool(connectionString: string = databaseUrl()): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}
