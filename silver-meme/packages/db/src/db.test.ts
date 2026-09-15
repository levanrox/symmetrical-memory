import { canonicalJson, generateDraw } from '@event-suite/draw-engine';
import { getRuleset } from '@event-suite/rules-engine';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  appendMatchEvent,
  assignCategoryToTatami,
  clearAll,
  createAthlete,
  createCategory,
  createEvent,
  createPool,
  createRegistration,
  createTatami,
  getDraw,
  getDrawGraph,
  listAssignmentsForTatami,
  listMatchEvents,
  listMatchesForCategory,
  listParticipantsForCategory,
  listRegistrations,
  lockDraw,
  migrate,
  resetDatabase,
  saveDraw,
  TEST_DATABASE_URL,
  upsertDevice,
  writeAudit,
} from './index';

const ruleset = getRuleset('WKF_KUMITE_2026');

let pool: Pool;

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL);
  // Migrate once: DDL is fsync-bound and re-running it per test is wasted work.
  await resetDatabase(pool);
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await clearAll(pool);
});

/** Creates an event with one category holding `entrantCount` athletes. */
async function seedCategory(entrantCount: number) {
  const event = await createEvent(pool, {
    name: 'Karnataka State Championship',
    rulesetId: ruleset.id,
    venue: 'Koramangala Indoor Stadium',
  });

  const tatami = await createTatami(pool, { eventId: event.id, number: 1, name: 'Tatami 1' });
  const category = await createCategory(pool, {
    eventId: event.id,
    name: 'Senior Male -67kg',
    ageGroup: 'senior',
    gender: 'MALE',
    minWeightKg: 67,
  });

  for (let index = 0; index < entrantCount; index += 1) {
    const athlete = await createAthlete(pool, {
      displayName: `Athlete ${index + 1}`,
      clubName: `Club ${index + 1}`,
    });

    await createRegistration(pool, {
      eventId: event.id,
      categoryId: category.id,
      athleteId: athlete.id,
      clubName: `Club ${index + 1}`,
    });
  }

  return { event, tatami, category };
}

describe('migrations', () => {
  it('reports nothing to apply when the schema is already up to date', async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it('applies from scratch once, then applies nothing', async () => {
    // The only test that pays for a full re-migration, because that is the
    // behaviour under test.
    await resetDatabase(pool);

    expect(await migrate(pool)).toEqual(['001-init']);
    expect(await migrate(pool)).toEqual([]);
  });
});

describe('registry', () => {
  it('issues athlete codes consecutively', async () => {
    // The sequence is not reset between tests, so assert the progression rather
    // than absolute values.
    const created = [
      await createAthlete(pool, { displayName: 'A' }),
      await createAthlete(pool, { displayName: 'B' }),
      await createAthlete(pool, { displayName: 'C' }),
    ];

    for (const athlete of created) {
      expect(athlete.publicCode).toMatch(/^KA-\d{6}$/);
    }

    const numbers = created.map((athlete) => Number(athlete.publicCode.slice(3)));
    const [first, second, third] = numbers;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('expected three codes');
    }

    expect(second).toBe(first + 1);
    expect(third).toBe(second + 1);
  });

  it('keeps athlete codes unique under concurrent creation', async () => {
    const created = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        createAthlete(pool, { displayName: `Concurrent ${index}` }),
      ),
    );

    expect(new Set(created.map((athlete) => athlete.publicCode)).size).toBe(25);
  });

  it('round-trips a date of birth without timezone drift', async () => {
    const athlete = await createAthlete(pool, {
      displayName: 'Dated',
      dateOfBirth: '2009-04-17',
    });

    expect(athlete.dateOfBirth).toBe('2009-04-17');
  });
});

describe('draws', () => {
  it('persists a generated draw and reads it back unchanged', async () => {
    const { category } = await seedCategory(8);
    const participants = await listParticipantsForCategory(pool, category.id);

    const graph = generateDraw(
      {
        categoryId: category.id,
        format: 'SINGLE_ELIM_REPECHAGE',
        participants,
        seeding: { mode: 'NONE' },
      },
      ruleset,
    );

    await saveDraw(pool, category.id, graph);

    // Compared canonically, not by JSON.stringify: `jsonb` stores object keys
    // in its own order, so raw string comparison would fail on key ordering
    // alone. The graph's own checksum is computed over canonical form, so
    // canonical comparison is the meaningful assertion.
    const reloaded = await getDrawGraph(pool, category.id);

    expect(canonicalJson(reloaded)).toEqual(canonicalJson(graph));
    expect(reloaded?.checksum).toBe(graph.checksum);
  });

  it('stores the draw record alongside the graph', async () => {
    const { category } = await seedCategory(8);
    const participants = await listParticipantsForCategory(pool, category.id);
    const graph = generateDraw(
      { categoryId: category.id, format: 'SINGLE_ELIM_REPECHAGE', participants, seeding: { mode: 'NONE' } },
      ruleset,
    );

    await saveDraw(pool, category.id, graph);
    const record = await getDraw(pool, category.id);

    expect(record?.tournamentSize).toBe(8);
    expect(record?.byeCount).toBe(0);
    expect(record?.checksum).toBe(graph.checksum);
    expect(record?.state).toBe('DRAFT');
    expect(record?.version).toBe(1);
  });

  it('explodes the graph into queryable matches and slots', async () => {
    const { category } = await seedCategory(8);
    const participants = await listParticipantsForCategory(pool, category.id);
    const graph = generateDraw(
      { categoryId: category.id, format: 'SINGLE_ELIM_REPECHAGE', participants, seeding: { mode: 'NONE' } },
      ruleset,
    );

    await saveDraw(pool, category.id, graph);
    const matches = await listMatchesForCategory(pool, category.id);

    // Seven in the main bracket, plus two bronze bouts from the repechage.
    expect(matches).toHaveLength(graph.matches.length);
    expect(matches.filter((match) => match.bracketType === 'MAIN')).toHaveLength(7);
    expect(matches.filter((match) => match.bracketType === 'BRONZE')).toHaveLength(2);

    expect(matches.every((match) => match.slots.length === 2)).toBe(true);
    expect(matches.find((match) => match.roundName === 'Final')?.slots.every((slot) => slot.slotType === 'WINNER_OF')).toBe(true);
  });

  it('bumps the version and replaces matches when regenerated', async () => {
    const { category } = await seedCategory(8);
    const participants = await listParticipantsForCategory(pool, category.id);

    const first = generateDraw(
      { categoryId: category.id, format: 'SINGLE_ELIM_REPECHAGE', participants, seeding: { mode: 'NONE' } },
      ruleset,
    );
    await saveDraw(pool, category.id, first);

    const second = generateDraw(
      {
        categoryId: category.id,
        format: 'SINGLE_ELIM_REPECHAGE',
        participants,
        seeding: { mode: 'RANDOM_SEEDED', randomSeed: 99 },
      },
      ruleset,
    );
    await saveDraw(pool, category.id, second);

    const record = await getDraw(pool, category.id);
    expect(record?.version).toBe(2);
    expect(record?.checksum).toBe(second.checksum);

    // Regeneration must not leave the old bracket behind, including its
    // repechage and bronze bouts.
    expect(await listMatchesForCategory(pool, category.id)).toHaveLength(second.matches.length);
  });

  it('locks once and refuses a second lock', async () => {
    const { category } = await seedCategory(4);
    const participants = await listParticipantsForCategory(pool, category.id);
    const graph = generateDraw(
      { categoryId: category.id, format: 'SINGLE_ELIM_REPECHAGE', participants, seeding: { mode: 'NONE' } },
      ruleset,
    );

    await saveDraw(pool, category.id, graph);

    expect(await lockDraw(pool, category.id)).toBe(true);
    expect(await lockDraw(pool, category.id)).toBe(false);
    expect((await getDraw(pool, category.id))?.state).toBe('LOCKED');
  });
});

describe('ring assignment', () => {
  it('assigns categories to a tatami in order', async () => {
    const { event, tatami, category } = await seedCategory(4);

    await assignCategoryToTatami(pool, {
      eventId: event.id,
      tatamiId: tatami.id,
      categoryId: category.id,
    });

    const assignments = await listAssignmentsForTatami(pool, tatami.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.categoryId).toBe(category.id);
    expect(assignments[0]?.sequence).toBe(0);
  });

  it('moves a category rather than duplicating the assignment', async () => {
    const { event, tatami, category } = await seedCategory(4);
    const second = await createTatami(pool, { eventId: event.id, number: 2, name: 'Tatami 2' });

    await assignCategoryToTatami(pool, { eventId: event.id, tatamiId: tatami.id, categoryId: category.id });
    await assignCategoryToTatami(pool, { eventId: event.id, tatamiId: second.id, categoryId: category.id });

    expect(await listAssignmentsForTatami(pool, tatami.id)).toHaveLength(0);
    expect(await listAssignmentsForTatami(pool, second.id)).toHaveLength(1);
  });
});

describe('match events', () => {
  it('appends events with increasing sequence numbers', async () => {
    const { category } = await seedCategory(4);
    const participants = await listParticipantsForCategory(pool, category.id);
    const graph = generateDraw(
      { categoryId: category.id, format: 'SINGLE_ELIM_REPECHAGE', participants, seeding: { mode: 'NONE' } },
      ruleset,
    );
    await saveDraw(pool, category.id, graph);

    const matchId = graph.matches[0]?.id;
    if (matchId === undefined) throw new Error('expected a match');

    await appendMatchEvent(pool, { matchId, type: 'MATCH_CALLED' });
    await appendMatchEvent(pool, { matchId, type: 'MATCH_START' });
    await appendMatchEvent(pool, { matchId, type: 'SCORE', payload: { side: 'AKA', value: 3 } });

    const events = await listMatchEvents(pool, matchId);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.type)).toEqual(['MATCH_CALLED', 'MATCH_START', 'SCORE']);
  });

  it('ignores a replayed command instead of scoring twice', async () => {
    const { category } = await seedCategory(4);
    const participants = await listParticipantsForCategory(pool, category.id);
    const graph = generateDraw(
      { categoryId: category.id, format: 'SINGLE_ELIM_REPECHAGE', participants, seeding: { mode: 'NONE' } },
      ruleset,
    );
    await saveDraw(pool, category.id, graph);

    const matchId = graph.matches[0]?.id;
    if (matchId === undefined) throw new Error('expected a match');

    const commandId = '11111111-2222-7333-8444-555555555555';

    const first = await appendMatchEvent(pool, {
      matchId,
      type: 'SCORE',
      payload: { side: 'AKA', value: 3 },
      commandId,
    });
    const replay = await appendMatchEvent(pool, {
      matchId,
      type: 'SCORE',
      payload: { side: 'AKA', value: 3 },
      commandId,
    });

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.event.id).toBe(first.event.id);

    // The whole point: one event, not two.
    expect(await listMatchEvents(pool, matchId)).toHaveLength(1);
  });

  it('keeps sequence numbers distinct when appends race', async () => {
    const { category } = await seedCategory(4);
    const participants = await listParticipantsForCategory(pool, category.id);
    const graph = generateDraw(
      { categoryId: category.id, format: 'SINGLE_ELIM_REPECHAGE', participants, seeding: { mode: 'NONE' } },
      ruleset,
    );
    await saveDraw(pool, category.id, graph);

    const matchId = graph.matches[0]?.id;
    if (matchId === undefined) throw new Error('expected a match');

    await Promise.all(
      Array.from({ length: 10 }, () => appendMatchEvent(pool, { matchId, type: 'CLOCK_START' })),
    );

    const events = await listMatchEvents(pool, matchId);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('devices and audit', () => {
  it('re-enrols the same device by name rather than duplicating it', async () => {
    const { event, tatami } = await seedCategory(2);

    const first = await upsertDevice(pool, {
      eventId: event.id,
      name: 'TATAMI-01',
      kind: 'tatami_laptop',
      tatamiId: tatami.id,
    });
    const second = await upsertDevice(pool, {
      eventId: event.id,
      name: 'TATAMI-01',
      kind: 'tatami_laptop',
      tatamiId: tatami.id,
    });

    expect(second.id).toBe(first.id);
  });

  it('records an audit entry', async () => {
    const { event } = await seedCategory(2);

    await writeAudit(pool, {
      eventId: event.id,
      actor: 'admin@example.com',
      action: 'DRAW_LOCKED',
      entityType: 'category',
      entityId: 'abc',
      detail: { reason: 'entries closed' },
    });

    const result = await pool.query<{ action: string }>('SELECT action FROM audit_logs');
    expect(result.rows.map((row) => row.action)).toEqual(['DRAW_LOCKED']);
  });
});

describe('registrations', () => {
  it('lists approved registrations as draw participants', async () => {
    const { category } = await seedCategory(3);

    const registrations = await listRegistrations(pool, category.id);
    const participants = await listParticipantsForCategory(pool, category.id);

    expect(registrations).toHaveLength(3);
    expect(participants).toHaveLength(3);
    expect(participants[0]?.registrationId).toBe(registrations[0]?.id);
  });
});
