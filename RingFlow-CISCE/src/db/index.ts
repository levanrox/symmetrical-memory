import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Primary application database handle.
 *
 * In production this points at pgBouncer (`DATABASE_URL=...:6432`) — hence
 * `prepare: false`, because named prepared statements do not survive
 * transaction-mode pooling. The LISTEN bridge (`src/lib/realtime/bus.ts`)
 * deliberately uses DATABASE_DIRECT_URL instead: LISTEN needs a
 * session-scoped connection, which a pooler cannot provide.
 */

const connectionString =
  process.env.DATABASE_URL || 'postgres://event_suite:event_suite@127.0.0.1:5432/ringflow';

const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

export const client = globalForDb.conn ?? postgres(connectionString, { max: 10, prepare: false });
if (process.env.NODE_ENV !== 'production') globalForDb.conn = client;

export const db = drizzle(client, { schema });
export { schema };
