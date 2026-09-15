import type { DrawGraph } from '@event-suite/draw-engine';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createDb, schema } from '../drizzle';
import { uuidv7 } from '../ids';

export interface DrawRecord {
  id: string;
  categoryId: string;
  version: number;
  format: string;
  rulesetId: string;
  tournamentSize: number;
  byeCount: number;
  checksum: string;
  state: string;
  lockedAt: Date | null;
}

export interface Assignment {
  id: string;
  eventId: string;
  tatamiId: string;
  categoryId: string;
  sequence: number;
}

/**
 * Persists a generated draw.
 *
 * The graph is stored whole in `draw_versions` (the immutable record) *and*
 * exploded into `matches` / `match_slots` (the mutable runtime state). That is
 * deliberate duplication: reading the draw back is then a single jsonb fetch
 * with no reconstruction, while the runtime can still update one match's status
 * without rewriting the graph.
 *
 * Regenerating a draw replaces its matches, which cascades away any slots that
 * referenced them.
 */
export async function saveDraw(pool: Pool, categoryId: string, graph: DrawGraph): Promise<string> {
  const db = createDb(pool);

  return await db.transaction(async (tx) => {
    const existing = await tx.execute<{ id: string; version: number; state: string }>(
      sql`SELECT id, version, state FROM draws WHERE category_id = ${categoryId} FOR UPDATE`,
    );

    const current = existing.rows[0];
    const version = current === undefined ? 1 : current.version + 1;
    const drawId = current?.id ?? uuidv7();

    if (current === undefined) {
      await tx.insert(schema.draws).values({
        id: drawId,
        categoryId,
        version,
        format: graph.format,
        rulesetId: graph.rulesetId,
        tournamentSize: graph.tournamentSize,
        byeCount: graph.byeCount,
        checksum: graph.checksum,
        state: 'DRAFT',
      });
    } else {
      await tx
        .update(schema.draws)
        .set({
          version,
          format: graph.format,
          rulesetId: graph.rulesetId,
          tournamentSize: graph.tournamentSize,
          byeCount: graph.byeCount,
          checksum: graph.checksum,
        })
        .where(eq(schema.draws.id, drawId));
    }

    await tx.insert(schema.drawVersions).values({
      id: uuidv7(),
      drawId,
      version,
      graph: graph as any,
      checksum: graph.checksum,
      reason: `generated v${version}`,
    });

    await tx.delete(schema.matches).where(eq(schema.matches.categoryId, categoryId));

    if (graph.matches.length > 0) {
      await tx.insert(schema.matches).values(
        graph.matches.map((match) => ({
          id: match.id,
          categoryId,
          matchNo: match.matchNo,
          roundNo: match.roundNo,
          roundName: match.roundName,
          bracketType: match.bracketType,
        })),
      );
    }

    if (graph.slots.length > 0) {
      await tx.insert(schema.matchSlots).values(
        graph.slots.map((slot) => ({
          id: slot.id,
          matchId: slot.matchId,
          position: slot.position,
          slotType: slot.slotType,
          registrationId: slot.registrationId,
          sourceMatchId: slot.sourceMatchId,
        })),
      );
    }

    return drawId;
  });
}

/** Reads the newest version of a category's draw back as a graph. */
export async function getDrawGraph(pool: Pool, categoryId: string): Promise<DrawGraph | null> {
  const db = createDb(pool);
  const [row] = await db
    .select({ graph: schema.drawVersions.graph })
    .from(schema.draws)
    .innerJoin(
      schema.drawVersions,
      and(
        eq(schema.drawVersions.drawId, schema.draws.id),
        eq(schema.drawVersions.version, schema.draws.version),
      ),
    )
    .where(eq(schema.draws.categoryId, categoryId));

  return (row?.graph as DrawGraph) ?? null;
}

export async function getDraw(pool: Pool, categoryId: string): Promise<DrawRecord | null> {
  const db = createDb(pool);
  const [row] = await db
    .select()
    .from(schema.draws)
    .where(eq(schema.draws.categoryId, categoryId));

  if (row === undefined) return null;

  return {
    id: row.id,
    categoryId: row.categoryId,
    version: row.version,
    format: row.format,
    rulesetId: row.rulesetId,
    tournamentSize: row.tournamentSize,
    byeCount: row.byeCount,
    checksum: row.checksum,
    state: row.state,
    lockedAt: row.lockedAt,
  };
}

/**
 * Locks a draw. Once locked the graph is immutable; a change requires a new
 * version, which `saveDraw` produces. Returns false if it was already locked,
 * so the caller can report that rather than silently succeeding.
 */
export async function lockDraw(pool: Pool, categoryId: string): Promise<boolean> {
  const db = createDb(pool);
  const result = await db
    .update(schema.draws)
    .set({ state: 'LOCKED', lockedAt: new Date() })
    .where(and(eq(schema.draws.categoryId, categoryId), ne(schema.draws.state, 'LOCKED')))
    .returning({ id: schema.draws.id });

  return result.length > 0;
}

export async function isDrawLocked(pool: Pool, categoryId: string): Promise<boolean> {
  const record = await getDraw(pool, categoryId);
  return record?.state === 'LOCKED';
}

export async function assignCategoryToTatami(
  pool: Pool,
  input: { eventId: string; tatamiId: string; categoryId: string; sequence?: number },
): Promise<Assignment> {
  const db = createDb(pool);
  const id = uuidv7();

  let sequence = input.sequence;
  if (sequence === undefined) {
    const [result] = await db
      .select({
        next: sql<number>`coalesce(max(${schema.tatamiAssignments.sequence}), -1) + 1`,
      })
      .from(schema.tatamiAssignments)
      .where(eq(schema.tatamiAssignments.tatamiId, input.tatamiId));
    sequence = Number(result?.next ?? 0);
  }

  await db
    .insert(schema.tatamiAssignments)
    .values({
      id,
      eventId: input.eventId,
      tatamiId: input.tatamiId,
      categoryId: input.categoryId,
      sequence,
    })
    .onConflictDoUpdate({
      target: schema.tatamiAssignments.categoryId,
      set: {
        tatamiId: input.tatamiId,
        sequence,
      },
    });

  return { id, eventId: input.eventId, tatamiId: input.tatamiId, categoryId: input.categoryId, sequence };
}

export async function listAssignmentsForEvent(
  pool: Pool,
  eventId: string,
): Promise<Assignment[]> {
  const db = createDb(pool);
  const rows = await db
    .select()
    .from(schema.tatamiAssignments)
    .where(eq(schema.tatamiAssignments.eventId, eventId))
    .orderBy(asc(schema.tatamiAssignments.tatamiId), asc(schema.tatamiAssignments.sequence));

  return rows.map(mapAssignment);
}

export async function listAssignmentsForTatami(
  pool: Pool,
  tatamiId: string,
): Promise<Assignment[]> {
  const db = createDb(pool);
  const rows = await db
    .select()
    .from(schema.tatamiAssignments)
    .where(eq(schema.tatamiAssignments.tatamiId, tatamiId))
    .orderBy(asc(schema.tatamiAssignments.sequence));

  return rows.map(mapAssignment);
}

/** Category ids on a ring, in running order. */
export async function listCategoryIdsForTatami(pool: Pool, tatamiId: string): Promise<string[]> {
  const assignments = await listAssignmentsForTatami(pool, tatamiId);
  return assignments.map((assignment) => assignment.categoryId);
}

function mapAssignment(row: typeof schema.tatamiAssignments.$inferSelect): Assignment {
  return {
    id: row.id,
    eventId: row.eventId,
    tatamiId: row.tatamiId,
    categoryId: row.categoryId,
    sequence: row.sequence,
  };
}
