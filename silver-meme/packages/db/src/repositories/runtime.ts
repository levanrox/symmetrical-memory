import { asc, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createDb, type DbClient, schema } from '../drizzle';
import { uuidv7 } from '../ids';

export interface MatchEventRecord {
  id: string;
  matchId: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  actor: string | null;
  deviceId: string | null;
  commandId: string | null;
  ts: Date;
}

export interface MatchSlotRecord {
  id: string;
  position: number;
  slotType: string;
  registrationId: string | null;
  sourceMatchId: string | null;
}

export interface MatchWithSlots {
  id: string;
  categoryId: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: string;
  status: string;
  slots: MatchSlotRecord[];
}

export interface DeviceRecord {
  id: string;
  eventId: string;
  name: string;
  kind: string;
  tatamiId: string | null;
  lastSeenAt: Date | null;
}

/**
 * Appends an event to a match's log.
 *
 * Idempotent by `commandId`: a retried command returns the event that already
 * exists instead of appending a second one.
 *
 * `seq` is allocated inside a transaction that locks the match row, so two
 * concurrent writers on the same match cannot collide.
 */
export async function appendMatchEvent(
  pool: Pool,
  input: {
    matchId: string;
    type: string;
    payload?: Record<string, unknown>;
    actor?: string | null;
    deviceId?: string | null;
    commandId?: string | null;
  },
): Promise<{ event: MatchEventRecord; duplicate: boolean }> {
  const db = createDb(pool);

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM matches WHERE id = ${input.matchId} FOR UPDATE`);

    if (typeof input.commandId === 'string') {
      const [existing] = await tx
        .select()
        .from(schema.matchEvents)
        .where(eq(schema.matchEvents.commandId, input.commandId));

      if (existing !== undefined) {
        return { event: mapEvent(existing), duplicate: true };
      }
    }

    const [seqResult] = await tx
      .select({
        next: sql<number>`coalesce(max(${schema.matchEvents.seq}), 0) + 1`,
      })
      .from(schema.matchEvents)
      .where(eq(schema.matchEvents.matchId, input.matchId));

    const seq = Number(seqResult?.next ?? 1);

    const [inserted] = await tx
      .insert(schema.matchEvents)
      .values({
        id: uuidv7(),
        matchId: input.matchId,
        seq,
        type: input.type,
        payload: input.payload ?? {},
        actor: input.actor ?? null,
        deviceId: input.deviceId ?? null,
        commandId: input.commandId ?? null,
      })
      .returning();

    if (inserted === undefined) {
      throw new Error('Internal error: insert returned no row');
    }

    return { event: mapEvent(inserted), duplicate: false };
  });
}

export async function listMatchEvents(pool: Pool, matchId: string): Promise<MatchEventRecord[]> {
  const db = createDb(pool);
  const rows = await db
    .select()
    .from(schema.matchEvents)
    .where(eq(schema.matchEvents.matchId, matchId))
    .orderBy(asc(schema.matchEvents.seq));

  return rows.map(mapEvent);
}

export async function setMatchStatus(pool: Pool, matchId: string, status: string): Promise<void> {
  const db = createDb(pool);
  await db.update(schema.matches).set({ status }).where(eq(schema.matches.id, matchId));
}

export async function getMatch(pool: Pool, matchId: string): Promise<MatchWithSlots | null> {
  const db = createDb(pool);
  const [row] = await db.select().from(schema.matches).where(eq(schema.matches.id, matchId));

  if (row === undefined) return null;

  return withSlots(db, row);
}

export async function listMatchesForCategory(
  pool: Pool,
  categoryId: string,
): Promise<MatchWithSlots[]> {
  const db = createDb(pool);
  const rows = await db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.categoryId, categoryId))
    .orderBy(asc(schema.matches.matchNo));

  const matches: MatchWithSlots[] = [];
  for (const row of rows) {
    matches.push(await withSlots(db, row));
  }

  return matches;
}

export async function writeAudit(
  pool: Pool,
  input: {
    eventId?: string | null;
    actor?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const db = createDb(pool);

  await db.insert(schema.auditLogs).values({
    id: uuidv7(),
    eventId: input.eventId ?? null,
    actor: input.actor ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    detail: input.detail ?? {},
  });
}

export async function upsertDevice(
  pool: Pool,
  input: { eventId: string; name: string; kind: string; tatamiId?: string | null },
): Promise<DeviceRecord> {
  const db = createDb(pool);

  const [row] = await db
    .insert(schema.devices)
    .values({
      id: uuidv7(),
      eventId: input.eventId,
      name: input.name,
      kind: input.kind,
      tatamiId: input.tatamiId ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.devices.eventId, schema.devices.name],
      set: {
        kind: input.kind,
        tatamiId: input.tatamiId ?? null,
        lastSeenAt: new Date(),
      },
    })
    .returning();

  if (row === undefined) throw new Error('Internal error: device upsert returned no row');

  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    kind: row.kind,
    tatamiId: row.tatamiId,
    lastSeenAt: row.lastSeenAt,
  };
}

export async function listDevices(pool: Pool, eventId: string): Promise<DeviceRecord[]> {
  const db = createDb(pool);
  const rows = await db
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.eventId, eventId))
    .orderBy(asc(schema.devices.name));

  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    kind: row.kind,
    tatamiId: row.tatamiId,
    lastSeenAt: row.lastSeenAt,
  }));
}

async function withSlots(
  db: DbClient,
  row: typeof schema.matches.$inferSelect,
): Promise<MatchWithSlots> {
  const slots = await db
    .select()
    .from(schema.matchSlots)
    .where(eq(schema.matchSlots.matchId, row.id))
    .orderBy(asc(schema.matchSlots.position));

  return {
    id: row.id,
    categoryId: row.categoryId,
    matchNo: row.matchNo,
    roundNo: row.roundNo,
    roundName: row.roundName,
    bracketType: row.bracketType,
    status: row.status,
    slots: slots.map((slot) => ({
      id: slot.id,
      position: slot.position,
      slotType: slot.slotType,
      registrationId: slot.registrationId,
      sourceMatchId: slot.sourceMatchId,
    })),
  };
}

function mapEvent(row: typeof schema.matchEvents.$inferSelect): MatchEventRecord {
  return {
    id: row.id,
    matchId: row.matchId,
    seq: row.seq,
    type: row.type,
    payload: (row.payload as Record<string, unknown>) ?? {},
    actor: row.actor,
    deviceId: row.deviceId,
    commandId: row.commandId,
    ts: row.ts,
  };
}
