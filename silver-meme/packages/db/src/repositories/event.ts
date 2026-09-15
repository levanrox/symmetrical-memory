import type { Participant } from '@event-suite/draw-engine';
import { asc, desc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createDb, schema } from '../drizzle';
import { uuidv7 } from '../ids';
import { toNumberOrNull } from '../rowutil';

export interface EventRecord {
  id: string;
  name: string;
  venue: string | null;
  startsOn: string | null;
  endsOn: string | null;
  rulesetId: string;
}

export interface Tatami {
  id: string;
  eventId: string;
  number: number;
  name: string;
}

export interface Category {
  id: string;
  eventId: string;
  name: string;
  ageGroup: string;
  gender: string;
  discipline: string;
  minWeightKg: number | null;
  maxWeightKg: number | null;
  state: string;
}

export interface Registration {
  id: string;
  eventId: string;
  categoryId: string;
  athleteId: string;
  displayName: string;
  clubName: string | null;
  seed: number | null;
  status: string;
}

export async function createEvent(
  pool: Pool,
  input: {
    name: string;
    rulesetId: string;
    venue?: string | null;
    startsOn?: string | null;
    endsOn?: string | null;
  },
): Promise<EventRecord> {
  const db = createDb(pool);
  const id = uuidv7();

  await db.insert(schema.events).values({
    id,
    name: input.name,
    rulesetId: input.rulesetId,
    venue: input.venue ?? null,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
  });

  return {
    id,
    name: input.name,
    venue: input.venue ?? null,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
    rulesetId: input.rulesetId,
  };
}

export async function getEvent(pool: Pool, id: string): Promise<EventRecord | null> {
  const db = createDb(pool);
  const [row] = await db.select().from(schema.events).where(eq(schema.events.id, id));

  return row === undefined
    ? null
    : {
        id: row.id,
        name: row.name,
        venue: row.venue,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        rulesetId: row.rulesetId,
      };
}

export async function listEvents(pool: Pool): Promise<EventRecord[]> {
  const db = createDb(pool);
  const rows = await db.select().from(schema.events).orderBy(desc(schema.events.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    venue: row.venue,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    rulesetId: row.rulesetId,
  }));
}

export async function createTatami(
  pool: Pool,
  input: { eventId: string; number: number; name: string },
): Promise<Tatami> {
  const db = createDb(pool);
  const id = uuidv7();

  await db.insert(schema.tatamis).values({
    id,
    eventId: input.eventId,
    number: input.number,
    name: input.name,
  });

  return { id, eventId: input.eventId, number: input.number, name: input.name };
}

export async function listTatamis(pool: Pool, eventId: string): Promise<Tatami[]> {
  const db = createDb(pool);
  const rows = await db
    .select()
    .from(schema.tatamis)
    .where(eq(schema.tatamis.eventId, eventId))
    .orderBy(asc(schema.tatamis.number));

  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    number: row.number,
    name: row.name,
  }));
}

export async function createCategory(
  pool: Pool,
  input: {
    eventId: string;
    name: string;
    ageGroup: string;
    gender: string;
    discipline?: string;
    minWeightKg?: number | null;
    maxWeightKg?: number | null;
  },
): Promise<Category> {
  const db = createDb(pool);
  const id = uuidv7();
  const discipline = input.discipline ?? 'KUMITE';

  await db.insert(schema.categories).values({
    id,
    eventId: input.eventId,
    name: input.name,
    ageGroup: input.ageGroup,
    gender: input.gender,
    discipline,
    minWeightKg: input.minWeightKg != null ? String(input.minWeightKg) : null,
    maxWeightKg: input.maxWeightKg != null ? String(input.maxWeightKg) : null,
  });

  return {
    id,
    eventId: input.eventId,
    name: input.name,
    ageGroup: input.ageGroup,
    gender: input.gender,
    discipline,
    minWeightKg: input.minWeightKg ?? null,
    maxWeightKg: input.maxWeightKg ?? null,
    state: 'CREATED',
  };
}

export async function getCategory(pool: Pool, id: string): Promise<Category | null> {
  const db = createDb(pool);
  const [row] = await db.select().from(schema.categories).where(eq(schema.categories.id, id));
  return row === undefined ? null : mapCategory(row);
}

export async function listCategories(pool: Pool, eventId: string): Promise<Category[]> {
  const db = createDb(pool);
  const rows = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.eventId, eventId))
    .orderBy(asc(schema.categories.name));

  return rows.map(mapCategory);
}

export async function setCategoryState(pool: Pool, id: string, state: string): Promise<void> {
  const db = createDb(pool);
  await db.update(schema.categories).set({ state }).where(eq(schema.categories.id, id));
}

export async function createRegistration(
  pool: Pool,
  input: {
    eventId: string;
    categoryId: string;
    athleteId: string;
    clubName?: string | null;
    seed?: number | null;
    status?: string;
  },
): Promise<string> {
  const db = createDb(pool);
  const id = uuidv7();

  await db.insert(schema.registrations).values({
    id,
    eventId: input.eventId,
    categoryId: input.categoryId,
    athleteId: input.athleteId,
    clubName: input.clubName ?? null,
    seed: input.seed ?? null,
    status: input.status ?? 'APPROVED',
  });

  return id;
}

export async function listRegistrations(
  pool: Pool,
  categoryId: string,
): Promise<Registration[]> {
  const db = createDb(pool);
  const rows = await db
    .select({
      id: schema.registrations.id,
      eventId: schema.registrations.eventId,
      categoryId: schema.registrations.categoryId,
      athleteId: schema.registrations.athleteId,
      clubName: schema.registrations.clubName,
      seed: schema.registrations.seed,
      status: schema.registrations.status,
      displayName: schema.athletes.displayName,
    })
    .from(schema.registrations)
    .innerJoin(schema.athletes, eq(schema.athletes.id, schema.registrations.athleteId))
    .where(eq(schema.registrations.categoryId, categoryId))
    .orderBy(asc(schema.athletes.displayName));

  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    categoryId: row.categoryId,
    athleteId: row.athleteId,
    displayName: row.displayName,
    clubName: row.clubName,
    seed: row.seed,
    status: row.status,
  }));
}

/**
 * Maps approved registrations into the shape the draw engine consumes.
 *
 * `districtId` is not modelled yet, so district separation simply finds no
 * clashes — honest, rather than pretending the data exists.
 */
export async function listParticipantsForCategory(
  pool: Pool,
  categoryId: string,
): Promise<Participant[]> {
  const registrations = await listRegistrations(pool, categoryId);

  return registrations
    .filter((registration) => registration.status === 'APPROVED')
    .map((registration) => ({
      registrationId: registration.id,
      displayName: registration.displayName,
      clubId: registration.clubName ?? 'unknown',
      districtId: null,
    }));
}

function mapCategory(row: typeof schema.categories.$inferSelect): Category {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    ageGroup: row.ageGroup,
    gender: row.gender,
    discipline: row.discipline,
    minWeightKg: toNumberOrNull(row.minWeightKg),
    maxWeightKg: toNumberOrNull(row.maxWeightKg),
    state: row.state,
  };
}
