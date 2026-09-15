import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema';

export type DbClient = NodePgDatabase<typeof schema>;

export function createDb(pool: Pool): DbClient {
  return drizzle(pool, { schema });
}

export { schema };
