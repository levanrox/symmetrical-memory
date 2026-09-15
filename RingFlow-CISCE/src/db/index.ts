import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL || 'postgres://event_suite:event_suite@127.0.0.1:5432/ringflow';

const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

export const client = globalForDb.conn ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== 'production') globalForDb.conn = client;

export const db = drizzle(client, { schema });
export { schema };
