import { describe, expect, it } from 'vitest';
import type { DrawInputIssue } from './errors';
import { createRng, orderParticipants, shuffle } from './seeding';
import type { DrawWarning, Participant, SeedingOptions } from './types';

function participant(id: string): Participant {
  return { registrationId: id, displayName: id.toUpperCase(), clubId: 'club-a', districtId: 'd1' };
}

const FOUR = [participant('a'), participant('b'), participant('c'), participant('d')];

function run(
  participants: readonly Participant[],
  seeding: SeedingOptions,
): { ordered: ReturnType<typeof orderParticipants>; issues: DrawInputIssue[]; warnings: DrawWarning[] } {
  const issues: DrawInputIssue[] = [];
  const warnings: DrawWarning[] = [];
  const ordered = orderParticipants(participants, seeding, issues, warnings);
  return { ordered, issues, warnings };
}

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const first = createRng(42);
    const second = createRng(42);

    const a = [first(), first(), first()];
    const b = [second(), second(), second()];

    expect(a).toEqual(b);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1)();
    const b = createRng(2)();

    expect(a).not.toBe(b);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1_000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('shuffle', () => {
  it('is reproducible for the same seed', () => {
    const a = shuffle(FOUR, createRng(99));
    const b = shuffle(FOUR, createRng(99));

    expect(a.map((p) => p.registrationId)).toEqual(b.map((p) => p.registrationId));
  });

  it('preserves every element exactly once', () => {
    const shuffled = shuffle(FOUR, createRng(5));

    expect([...shuffled].map((p) => p.registrationId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not mutate the input', () => {
    const input = [...FOUR];
    shuffle(input, createRng(3));

    expect(input.map((p) => p.registrationId)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('orderParticipants — NONE', () => {
  it('seeds entrants 1..n in entry order', () => {
    const { ordered } = run(FOUR, { mode: 'NONE' });

    expect(ordered.map((o) => [o.participant.registrationId, o.seed])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);
  });

  it('marks no seed as explicit', () => {
    const { ordered } = run(FOUR, { mode: 'NONE' });
    expect(ordered.every((o) => !o.explicitSeed)).toBe(true);
  });
});

describe('orderParticipants — RANDOM_SEEDED', () => {
  it('is reproducible from the stored random seed', () => {
    const first = run(FOUR, { mode: 'RANDOM_SEEDED', randomSeed: 1234 });
    const second = run(FOUR, { mode: 'RANDOM_SEEDED', randomSeed: 1234 });

    expect(first.ordered.map((o) => o.participant.registrationId)).toEqual(
      second.ordered.map((o) => o.participant.registrationId),
    );
  });

  it('requires a random seed rather than silently using a random one', () => {
    const { issues } = run(FOUR, { mode: 'RANDOM_SEEDED' });

    expect(issues.map((i) => i.code)).toContain('MISSING_RANDOM_SEED');
  });
});

describe('orderParticipants — MANUAL and RANKING', () => {
  it('preserves explicit seed numbers exactly as given', () => {
    // An organiser saying "these two are my top seeds" must not have them
    // renumbered into 1 and 2 if they asked for 1 and 5.
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(participant);

    const { ordered, issues } = run(six, {
      mode: 'MANUAL',
      seeds: [
        { registrationId: 'a', seed: 1 },
        { registrationId: 'c', seed: 5 },
      ],
    });

    expect(issues).toEqual([]);

    const seedOf = (id: string) => ordered.find((o) => o.participant.registrationId === id)?.seed;

    expect(seedOf('a')).toBe(1);
    expect(seedOf('c')).toBe(5);
  });

  it('hands the remaining seed numbers to unseeded entrants in entry order', () => {
    const { ordered } = run(FOUR, {
      mode: 'MANUAL',
      seeds: [{ registrationId: 'a', seed: 1 }],
    });

    const byId = new Map(ordered.map((o) => [o.participant.registrationId, o.seed]));

    expect(byId.get('a')).toBe(1);
    expect(new Set(byId.values())).toEqual(new Set([1, 2, 3, 4]));
  });

  it('warns, but does not fail, when only some entrants are seeded', () => {
    const { issues, warnings } = run(FOUR, {
      mode: 'MANUAL',
      seeds: [{ registrationId: 'a', seed: 1 }],
    });

    expect(issues).toEqual([]);
    expect(warnings.map((w) => w.code)).toContain('MISSING_SEED');
  });

  it('does not warn when every entrant is seeded', () => {
    const { warnings } = run(FOUR, {
      mode: 'RANKING',
      seeds: FOUR.map((p, index) => ({ registrationId: p.registrationId, seed: index + 1 })),
    });

    expect(warnings).toEqual([]);
  });

  it('rejects a duplicate seed number', () => {
    const { issues } = run(FOUR, {
      mode: 'MANUAL',
      seeds: [
        { registrationId: 'a', seed: 1 },
        { registrationId: 'b', seed: 1 },
      ],
    });

    expect(issues.map((i) => i.code)).toContain('DUPLICATE_SEED');
  });

  it('rejects a seed outside the entrant range', () => {
    const { issues } = run(FOUR, {
      mode: 'MANUAL',
      seeds: [{ registrationId: 'a', seed: 9 }],
    });

    expect(issues.map((i) => i.code)).toContain('SEED_OUT_OF_RANGE');
  });

  it('rejects a non-integer or non-positive seed', () => {
    const fractional = run(FOUR, {
      mode: 'MANUAL',
      seeds: [{ registrationId: 'a', seed: 1.5 }],
    });
    const zero = run(FOUR, {
      mode: 'MANUAL',
      seeds: [{ registrationId: 'a', seed: 0 }],
    });

    expect(fractional.issues.map((i) => i.code)).toContain('INVALID_SEED');
    expect(zero.issues.map((i) => i.code)).toContain('INVALID_SEED');
  });

  it('rejects a seed naming an athlete who is not in this category', () => {
    const { issues } = run(FOUR, {
      mode: 'MANUAL',
      seeds: [{ registrationId: 'ghost', seed: 1 }],
    });

    expect(issues.map((i) => i.code)).toContain('UNKNOWN_SEED_REGISTRATION');
  });

  it('reports every seeding problem at once', () => {
    const { issues } = run(FOUR, {
      mode: 'MANUAL',
      seeds: [
        { registrationId: 'a', seed: 1 },
        { registrationId: 'a', seed: 1 },
        { registrationId: 'ghost', seed: 2 },
        { registrationId: 'b', seed: 99 },
      ],
    });

    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('assigns every entrant exactly one seed in every mode', () => {
    const modes: SeedingOptions[] = [
      { mode: 'NONE' },
      { mode: 'RANDOM_SEEDED', randomSeed: 11 },
      { mode: 'MANUAL', seeds: [{ registrationId: 'b', seed: 2 }] },
      { mode: 'RANKING', seeds: [{ registrationId: 'd', seed: 1 }] },
    ];

    for (const seeding of modes) {
      const { ordered, issues } = run(FOUR, seeding);
      expect(issues, `mode ${seeding.mode}`).toEqual([]);

      const seeds = ordered.map((o) => o.seed).sort((a, b) => a - b);
      expect(seeds, `mode ${seeding.mode}`).toEqual([1, 2, 3, 4]);
      expect(new Set(ordered.map((o) => o.participant.registrationId)).size).toBe(4);
    }
  });
});
