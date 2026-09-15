import { createPool, migrate, type Pool } from '@event-suite/db';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

/**
 * One pool for the process, migrated on boot.
 *
 * Migrating at startup rather than as a separate deploy step is deliberate: the
 * venue box has no deployment pipeline, and a server that will not start on an
 * out-of-date schema is safer than one that starts and misbehaves.
 */
export const databaseProvider = {
  provide: DATABASE_POOL,
  useFactory: async (): Promise<Pool> => {
    const pool = createPool();
    const applied = await migrate(pool);

    if (applied.length > 0) {
      console.log(`[db] applied migrations: ${applied.join(', ')}`);
    }

    return pool;
  },
};

export function connectionInfo(): string {
  const url = process.env.DATABASE_URL ?? 'postgres://event_suite:***@127.0.0.1:5432/event_suite';
  return url.replace(/:[^:@/]+@/, ':***@');
}
