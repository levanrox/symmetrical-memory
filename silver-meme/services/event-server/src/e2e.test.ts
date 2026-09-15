import { createPool, migrate, resetDatabase } from '@event-suite/db';
import { PROTOCOL_VERSION, type ClientMessage } from '@event-suite/protocol';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule, configureApp } from './app.module';

/**
 * Its own database, not the one the `db` package tests use: turbo runs packages
 * in parallel, and two suites resetting one schema would destroy each other.
 */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgres://event_suite:event_suite@127.0.0.1:5432/event_suite_e2e';

// The pool is built from DATABASE_URL when the app is created, so this must be
// set before NestFactory.create runs.
process.env.DATABASE_URL = E2E_DATABASE_URL;
process.env.JWT_SECRET = 'integration-test-secret';

let app: INestApplication;
let baseUrl: string;
let token: string;

async function api<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  expectOk = true,
): Promise<T> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  const parsed = text.length === 0 ? null : JSON.parse(text);

  if (expectOk && !response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }

  return parsed as T;
}

/** Sends one scoring command as the ring client would. */
async function command(
  matchId: string,
  tatamiId: string,
  type: ClientMessage['type'],
  payload: Record<string, unknown>,
  commandId = randomUUID(),
): Promise<{ duplicate: boolean }> {
  const message = {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    ts: Date.now(),
    channel: `tatami:${tatamiId}`,
    type,
    payload: { matchId, commandId, ...payload },
  };

  return api<{ duplicate: boolean }>('POST', `/matches/${matchId}/commands`, message);
}

beforeAll(async () => {
  const pool = createPool(E2E_DATABASE_URL);
  await resetDatabase(pool);
  await migrate(pool);
  await pool.end();

  // abortOnError defaults to true, which calls process.abort() and destroys the
  // error message we need to read. Let it throw instead.
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');

  baseUrl = await app.getUrl();
  baseUrl = baseUrl.replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
});

describe('event server — preflight', () => {
  it('reports a healthy status without a token', async () => {
    const status = await api<{ ok: boolean; checks: Array<{ name: string; ok: boolean }> }>(
      'GET',
      '/status',
    );

    expect(status.ok).toBe(true);
    expect(status.checks.map((check) => check.name)).toEqual([
      'database',
      'migrations',
      'disk',
      'clock',
    ]);
    expect(status.checks.every((check) => check.ok)).toBe(true);
  });

  it('refuses the API without a token', async () => {
    const saved = token;
    token = '';
    const response = await fetch(`${baseUrl}/api/events`);

    expect(response.status).toBe(401);
    token = saved;
  });
});

describe('event server — a whole category, end to end', () => {
  let eventId: string;
  let tatamiId: string;
  let categoryId: string;

  it('creates the first operator and signs in', async () => {
    await api('POST', '/auth/register', {
      name: 'Event Admin',
      email: 'admin@example.com',
      password: 'correct-horse-battery',
    });

    const login = await api<{ token: string }>('POST', '/auth/login', {
      email: 'admin@example.com',
      password: 'correct-horse-battery',
    });

    expect(login.token).toBeTruthy();
    token = login.token;
  });

  it('refuses a second self-service registration', async () => {
    const saved = token;
    token = '';
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Impostor',
        email: 'impostor@example.com',
        password: 'let-me-in-please',
      }),
    });
    token = saved;

    expect(response.status).toBe(403);
  });

  it('sets up an event with a ring and a category', async () => {
    const event = await api<{ id: string }>('POST', '/events', {
      name: 'Karnataka State Karate Championship',
      venue: 'Koramangala Indoor Stadium',
    });
    eventId = event.id;

    const tatami = await api<{ id: string }>('POST', `/events/${eventId}/tatamis`, { number: 1 });
    tatamiId = tatami.id;

    const category = await api<{ id: string }>('POST', `/events/${eventId}/categories`, {
      name: 'Senior Male -67kg',
      ageGroup: 'senior',
      gender: 'MALE',
    });
    categoryId = category.id;

    expect(eventId).toBeTruthy();
    expect(tatamiId).toBeTruthy();
    expect(categoryId).toBeTruthy();
  });

  it('enters eight athletes', async () => {
    for (let index = 1; index <= 8; index += 1) {
      const athlete = await api<{ id: string }>('POST', '/athletes', {
        displayName: `Athlete ${index}`,
        clubName: `Club ${index}`,
      });

      await api('POST', `/categories/${categoryId}/registrations`, { athleteId: athlete.id });
    }

    const detail = await api<{ entrantCount: number }>('GET', `/categories/${categoryId}`);
    expect(detail.entrantCount).toBe(8);
  });

  it('generates a draw and reads it back', async () => {
    const generated = await api<{
      tournamentSize: number;
      byeCount: number;
      matchCount: number;
      bronzeMedals: number;
      checksum: string;
      warnings: Array<{ message: string }>;
    }>('POST', `/categories/${categoryId}/draw`, {});

    expect(generated.tournamentSize).toBe(8);
    expect(generated.byeCount).toBe(0);
    // Seven in the main bracket, plus two bronze bouts from the repechage.
    expect(generated.matchCount).toBe(9);
    expect(generated.bronzeMedals).toBe(2);

    const stored = await api<{ draw: { state: string; checksum: string } }>(
      'GET',
      `/categories/${categoryId}/draw`,
    );

    expect(stored.draw.state).toBe('DRAFT');
    expect(stored.draw.checksum).toBe(generated.checksum);
  });

  it('locks the draw and refuses a second lock', async () => {
    await api('POST', `/categories/${categoryId}/draw/lock`);

    const response = await fetch(`${baseUrl}/api/categories/${categoryId}/draw/lock`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(409);
  });

  it('refuses to regenerate a locked draw', async () => {
    const response = await fetch(`${baseUrl}/api/categories/${categoryId}/draw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(409);
  });

  it('refuses to assign a category whose draw is not locked', async () => {
    const event = await api<{ id: string }>('POST', '/events', {
      name: 'Second event',
      venue: 'Somewhere',
    });
    const category = await api<{ id: string }>('POST', `/events/${event.id}/categories`, {
      name: 'Cadet Female -47kg',
      ageGroup: 'cadet',
      gender: 'FEMALE',
    });
    const tatami = await api<{ id: string }>('POST', `/events/${event.id}/tatamis`, { number: 1 });

    const response = await fetch(`${baseUrl}/api/assignments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ eventId: event.id, tatamiId: tatami.id, categoryId: category.id }),
    });

    expect(response.status).toBe(409);
  });

  it('assigns the locked category to the ring', async () => {
    const assignment = await api<{ sequence: number }>('POST', '/assignments', {
      eventId,
      tatamiId,
      categoryId,
    });

    expect(assignment.sequence).toBe(0);
  });

  it('gives the ring a current match to run', async () => {
    const queue = await api<{ currentMatchId: string | null; categories: unknown[] }>(
      'GET',
      `/tatamis/${tatamiId}/queue`,
    );

    expect(queue.categories).toHaveLength(1);
    expect(queue.currentMatchId).not.toBeNull();
  });

  it('runs every match, advancing the winner each time', async () => {
    const visited: string[] = [];

    for (let step = 0; step < 20; step += 1) {
      const queue = await api<{ currentMatchId: string | null }>('GET', `/tatamis/${tatamiId}/queue`);
      const matchId = queue.currentMatchId;

      if (matchId === null) break;
      visited.push(matchId);

      const before = await api<{ aka: { displayName: string }; status: string }>(
        'GET',
        `/matches/${matchId}`,
      );
      expect(before.aka.displayName).not.toBe('');

      await command(matchId, tatamiId, 'CALL_MATCH', {});
      await command(matchId, tatamiId, 'START_MATCH', {});
      await command(matchId, tatamiId, 'SCORE', {
        side: 'AKA',
        value: 3,
        target: 'JODAN',
        technique: 'KERI',
      });
      await command(matchId, tatamiId, 'CONFIRM_RESULT', { winner: 'AKA', method: 'POINTS' });
    }

    // Eight entrants, no byes: seven main-bracket matches plus two bronze
    // bouts from the repechage, each played exactly once.
    expect(visited).toHaveLength(9);
    expect(new Set(visited).size).toBe(9);
  });

  it('awards a podium once the final is confirmed', async () => {
    const view = await api<{
      podium: { goldRegistrationId: string; silverRegistrationId: string | null; bronzeRegistrationIds: string[] } | null;
      matches: Array<{ status: string }>;
      readyMatchIds: string[];
    }>('GET', `/categories/${categoryId}/matches`);

    expect(view.podium).not.toBeNull();
    expect(view.podium?.goldRegistrationId).toBeTruthy();
    expect(view.podium?.silverRegistrationId).toBeTruthy();
    // The repechage awards two bronze medals, and every match is decided.
    expect(view.podium?.bronzeRegistrationIds).toHaveLength(2);
    expect(view.matches.filter((match) => match.status === 'FINISHED')).toHaveLength(9);
    expect(view.readyMatchIds).toEqual([]);
  });

  it('leaves the ring with nothing left to run', async () => {
    const queue = await api<{ currentMatchId: string | null }>('GET', `/tatamis/${tatamiId}/queue`);
    expect(queue.currentMatchId).toBeNull();
  });

  it('produces post-event results with a club medal table', async () => {
    const results = await api<{
      categories: Array<{
        categoryName: string;
        completed: boolean;
        gold: { name: string; club: string | null } | null;
        silver: { name: string } | null;
        bronze: unknown[];
      }>;
      medalsByClub: Array<{ club: string; gold: number; silver: number; bronze: number; total: number }>;
      totals: { completed: number; athletes: number };
    }>('GET', `/events/${eventId}/results`);

    expect(results.totals.athletes).toBe(8);

    const category = results.categories.find((entry) => entry.categoryName === 'Senior Male -67kg');
    expect(category?.completed).toBe(true);
    expect(category?.gold?.name).toBeTruthy();
    expect(category?.silver?.name).toBeTruthy();

    // The repechage awards two bronze medals.
    expect(category?.bronze).toHaveLength(2);

    // One gold and one silver, plus two bronzes.
    expect(results.medalsByClub.reduce((total, row) => total + row.gold, 0)).toBe(1);
    expect(
      results.medalsByClub.reduce((total, row) => total + row.bronze, 0),
    ).toBe(2);
  });

  it('exports results as CSV', async () => {
    const response = await fetch(`${baseUrl}/api/events/${eventId}/results.csv`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');

    const text = await response.text();
    const lines = text.split('\n');

    expect(lines[0]).toBe('"Category","Place","Athlete","Club"');
    expect(lines.some((line) => line.includes('"Senior Male -67kg","1"'))).toBe(true);
    // Every field is quoted, because club names contain commas.
    expect(lines[1]?.startsWith('"')).toBe(true);
  });
});

describe('event server — configurable bronze medals', () => {
  async function drawWithBronze(bronzeMedals: 1 | 2): Promise<{
    bronzeMatchCount: number;
    matchCount: number;
  }> {
    const event = await api<{ id: string }>('POST', '/events', {
      name: `Bronze ${bronzeMedals} event`,
      venue: 'Test hall',
    });
    const category = await api<{ id: string }>('POST', `/events/${event.id}/categories`, {
      name: `Bronze ${bronzeMedals} category`,
      ageGroup: 'senior',
      gender: 'MALE',
    });

    for (let index = 1; index <= 8; index += 1) {
      const athlete = await api<{ id: string }>('POST', '/athletes', {
        displayName: `Bronze Athlete ${bronzeMedals}-${index}`,
      });
      await api('POST', `/categories/${category.id}/registrations`, { athleteId: athlete.id });
    }

    const generated = await api<{ matchCount: number }>('POST', `/categories/${category.id}/draw`, {
      bronzeMedals,
    });

    const view = await api<{ matches: Array<{ bracketType: string }> }>(
      'GET',
      `/categories/${category.id}/matches`,
    );

    return {
      bronzeMatchCount: view.matches.filter((match) => match.bracketType === 'BRONZE').length,
      matchCount: generated.matchCount,
    };
  }

  it('awards two bronze bouts when the organiser asks for two bronzes', async () => {
    const result = await drawWithBronze(2);

    expect(result.bronzeMatchCount).toBe(2);
    expect(result.matchCount).toBe(9);
  });

  it('runs a single bronze bout when the organiser asks for one bronze', async () => {
    const result = await drawWithBronze(1);

    // One final bronze bout between the two line winners, plus the two ladders.
    expect(result.bronzeMatchCount).toBe(1);
    expect(result.matchCount).toBe(10);
  });
});

describe('event server — command idempotency', () => {
  it('ignores a replayed command rather than scoring twice', async () => {
    const event = await api<{ id: string }>('POST', '/events', {
      name: 'Idempotency event',
      venue: 'Test hall',
    });
    const tatami = await api<{ id: string }>('POST', `/events/${event.id}/tatamis`, { number: 1 });
    const category = await api<{ id: string }>('POST', `/events/${event.id}/categories`, {
      name: 'Junior Male -55kg',
      ageGroup: 'junior',
      gender: 'MALE',
    });

    for (let index = 1; index <= 4; index += 1) {
      const athlete = await api<{ id: string }>('POST', '/athletes', {
        displayName: `Idem Athlete ${index}`,
      });
      await api('POST', `/categories/${category.id}/registrations`, { athleteId: athlete.id });
    }

    await api('POST', `/categories/${category.id}/draw`, {});
    await api('POST', `/categories/${category.id}/draw/lock`);
    await api('POST', '/assignments', { eventId: event.id, tatamiId: tatami.id, categoryId: category.id });

    const matches = await api<{ readyMatchIds: string[] }>('GET', `/categories/${category.id}/matches`);
    const matchId = matches.readyMatchIds[0];
    expect(matchId).toBeTruthy();
    if (matchId === undefined) return;

    const commandId = randomUUID();
    await command(matchId, tatami.id, 'SCORE', { side: 'AKA', value: 3, target: 'JODAN', technique: 'KERI' }, commandId);
    const replay = await command(
      matchId,
      tatami.id,
      'SCORE',
      { side: 'AKA', value: 3, target: 'JODAN', technique: 'KERI' },
      commandId,
    );

    expect(replay.duplicate).toBe(true);

    const match = await api<{ state: { derived: { aka: { points: number } } } }>(
      'GET',
      `/matches/${matchId}`,
    );
    // One IPPON, not two.
    expect(match.state.derived.aka.points).toBe(3);
  });
});
