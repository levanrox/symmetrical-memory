import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createDb, schema } from '../drizzle';
import { uuidv7 } from '../ids';

export interface Organization {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
}

export interface Athlete {
  id: string;
  publicCode: string;
  displayName: string;
  dateOfBirth: string | null;
  gender: string | null;
  clubName: string | null;
  organizationId: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export async function createOrganization(
  pool: Pool,
  input: { name: string; kind: string; parentId?: string | null },
): Promise<Organization> {
  const db = createDb(pool);
  const id = uuidv7();

  await db.insert(schema.organizations).values({
    id,
    name: input.name,
    kind: input.kind,
    parentId: input.parentId ?? null,
  });

  return { id, name: input.name, kind: input.kind, parentId: input.parentId ?? null };
}

/**
 * Creates an athlete. The `public_code` is minted by a Postgres sequence, so
 * concurrent imports cannot collide on it.
 */
export async function createAthlete(
  pool: Pool,
  input: {
    displayName: string;
    dateOfBirth?: string | null;
    gender?: string | null;
    clubName?: string | null;
    organizationId?: string | null;
  },
): Promise<Athlete> {
  const db = createDb(pool);
  const id = uuidv7();

  const [row] = await db
    .insert(schema.athletes)
    .values({
      id,
      displayName: input.displayName,
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      clubName: input.clubName ?? null,
      organizationId: input.organizationId ?? null,
    })
    .returning();

  if (row === undefined) {
    throw new Error('Internal error: athlete insert returned no row');
  }

  return mapAthlete(row);
}

export async function findAthleteByPublicCode(pool: Pool, code: string): Promise<Athlete | null> {
  const db = createDb(pool);
  const [row] = await db
    .select()
    .from(schema.athletes)
    .where(eq(schema.athletes.publicCode, code));

  return row === undefined ? null : mapAthlete(row);
}

export async function listAthletes(pool: Pool): Promise<Athlete[]> {
  const db = createDb(pool);
  const rows = await db.select().from(schema.athletes).orderBy(asc(schema.athletes.displayName));
  return rows.map(mapAthlete);
}

export async function createUser(
  pool: Pool,
  input: { name: string; email: string; passwordHash: string; role?: string },
): Promise<User> {
  const db = createDb(pool);
  const id = uuidv7();
  const role = input.role ?? 'EVENT_ADMIN';

  await db.insert(schema.users).values({
    id,
    name: input.name,
    email: input.email,
    passwordHash: input.passwordHash,
    role,
  });

  return { id, name: input.name, email: input.email, role };
}

export async function findUserByEmail(
  pool: Pool,
  email: string,
): Promise<(User & { passwordHash: string }) | null> {
  const db = createDb(pool);
  const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email));

  if (row === undefined) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    passwordHash: row.passwordHash,
  };
}

export async function listOrganizations(pool: Pool): Promise<Organization[]> {
  const db = createDb(pool);
  const rows = await db.select().from(schema.organizations).orderBy(asc(schema.organizations.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parentId,
  }));
}

function mapAthlete(row: typeof schema.athletes.$inferSelect): Athlete {
  return {
    id: row.id,
    publicCode: row.publicCode,
    displayName: row.displayName,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    clubName: row.clubName,
    organizationId: row.organizationId,
  };
}
