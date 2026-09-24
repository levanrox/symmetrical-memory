import { getRuleset, type Ruleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { generateDraw } from './generate';
import { buildRepechage, REPECHAGE_ROUND_NAME } from './repechage';
import { resolveDraw, type MatchOutcome } from './resolution';
import type { DrawGraph, DrawInput, Participant } from './types';

const ruleset: Ruleset = getRuleset('WKF_KUMITE_2026');

function participant(id: string): Participant {
  return {
    registrationId: id,
    displayName: id.toUpperCase(),
    clubId: `club-${id}`,
    districtId: `d-${id}`,
  };
}

function entrants(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => participant(`p${i + 1}`));
}

function draw(n: number, options: DrawInput['options'] = {}): DrawGraph {
  return generateDraw(
    {
      categoryId: 'cat-1',
      format: 'SINGLE_ELIM_REPECHAGE',
      participants: entrants(n),
      seeding: { mode: 'NONE' },
      ...(options === undefined ? {} : { options }),
    },
    ruleset,
  );
}

function playThrough(graph: DrawGraph): Map<string, MatchOutcome> {
  const results = new Map<string, MatchOutcome>();

  for (let step = 0; step <= graph.matches.length; step += 1) {
    const resolution = resolveDraw(graph, results);
    const nextId = resolution.readyMatchIds[0];
    if (nextId === undefined) break;

    results.set(nextId, { kind: 'WINNER', side: 'AKA' });
  }

  return results;
}

function bronzeOf(graph: DrawGraph): readonly string[] {
  return resolveDraw(graph, playThrough(graph)).podium?.bronzeRegistrationIds ?? [];
}

describe('buildRepechage — structure', () => {
  it('adds no repechage to a bracket of two, which has no bronze to award', () => {
    const build = buildRepechage('cat-1', { roundsTotal: 1, bronzeMedals: 2, firstMatchNo: 1 });

    expect(build.matches).toEqual([]);
  });

  it('gives a four-entrant bracket one bronze bout per line, resolved as walkovers', () => {
    // Two rounds total, so one round per half: each finalist beat exactly one
    // person, who needs no bout to take a bronze.
    const build = buildRepechage('cat-1', { roundsTotal: 2, bronzeMedals: 2, firstMatchNo: 1 });

    expect(build.matches).toHaveLength(2);
    expect(build.matches.every((match) => match.bracketType === 'BRONZE')).toBe(true);

    const byes = build.slots.filter((slot) => slot.slotType === 'BYE');
    expect(byes).toHaveLength(2);
  });

  it('gives an eight-entrant bracket a single bronze bout per line', () => {
    const build = buildRepechage('cat-1', { roundsTotal: 3, bronzeMedals: 2, firstMatchNo: 1 });

    // Two rungs per line, so one ladder bout each, and that bout is the bronze.
    expect(build.matches).toHaveLength(2);
    expect(build.matches.every((match) => match.bracketType === 'BRONZE')).toBe(true);
  });

  it('gives a sixteen-entrant bracket a two-bout ladder per line', () => {
    const build = buildRepechage('cat-1', { roundsTotal: 4, bronzeMedals: 2, firstMatchNo: 1 });

    // Three rungs per line: two bouts, the top one being the bronze.
    expect(build.matches).toHaveLength(4);
    expect(build.matches.filter((match) => match.bracketType === 'BRONZE')).toHaveLength(2);
    expect(build.matches.filter((match) => match.bracketType === 'REPECHAGE')).toHaveLength(2);
  });

  it('runs only the semifinal losers against each other when local official one bronze is awarded', () => {
    const build = buildRepechage('cat-1', { roundsTotal: 3, bronzeMedals: 1, firstMatchNo: 1 });

    // Only one bronze match between the two semifinal losers — early round losers eliminated
    expect(build.matches).toHaveLength(1);
    expect(build.matches[0].bracketType).toBe('BRONZE');
  });

  it('generates zero extra matches when local official joint bronze (3) is awarded', () => {
    const build = buildRepechage('cat-1', { roundsTotal: 3, bronzeMedals: 3, firstMatchNo: 1 });

    expect(build.matches).toHaveLength(0);
  });

  it('binds every rung lazily, by line and round', () => {
    const build = buildRepechage('cat-1', { roundsTotal: 4, bronzeMedals: 2, firstMatchNo: 1 });

    const rungs = build.slots
      .filter((slot) => slot.slotType === 'REPECHAGE')
      .map((slot) => slot.repechageRule);

    expect(rungs.every((rule) => rule?.kind === 'LOSERS_TO_FINALIST')).toBe(true);
    // Both lines, and every round of each half, are represented.
    expect(new Set(rungs.map((rule) => rule?.line))).toEqual(new Set(['A', 'B']));
    expect(new Set(rungs.map((rule) => rule?.roundNo))).toEqual(new Set([0, 1, 2]));
  });
});

describe('repechage — the medals it actually awards', () => {
  it('gives both semifinal losers a bronze in a four-entrant category', () => {
    const graph = draw(4);

    // Seeds 1 and 4 meet in one semi, 2 and 3 in the other; AKA always wins, so
    // the losers are p4 and p3.
    expect(bronzeOf(graph).slice().sort()).toEqual(['p3', 'p4']);
  });

  it('awards no bronze at all when only two athletes enter', () => {
    const graph = draw(2);

    expect(graph.matches.filter((match) => match.bracketType !== 'MAIN')).toEqual([]);
    expect(bronzeOf(graph)).toEqual([]);
  });

  it('awards one bronze when a bye leaves a line with nobody in it', () => {
    // Three entrants: seed 1 gets a bye in the opening round, so only one
    // athlete ever lost to a finalist.
    const graph = draw(3);

    expect(bronzeOf(graph)).toEqual(['p3']);
  });

  it('brings back exactly the athletes each finalist beat, in an eight-entrant category', () => {
    const graph = draw(8);

    // Path of p1: beat p8 in the quarter-final, then p4 in the semi-final.
    // Path of p2: beat p7, then p3. Each pair fights; AKA wins each bout.
    expect(bronzeOf(graph).slice().sort()).toEqual(['p7', 'p8']);
  });

  it('awards a single bronze when the format asks for one', () => {
    const graph = draw(8, { bronzeMedals: 1 });

    const bronze = bronzeOf(graph);
    expect(bronze).toHaveLength(1);
    // The two semifinal losers (p4 and p3) meet; AKA (p4) takes it.
    expect(bronze).toEqual(['p4']);
  });

  it('awards no bronze at all when the organiser asks for none', () => {
    const graph = draw(8, { bronzeMedals: 0 });

    // No repechage ladder, no bronze bout, nobody on the third step.
    expect(graph.matches.filter((match) => match.bracketType !== 'MAIN')).toEqual([]);
    expect(bronzeOf(graph)).toEqual([]);
  });

  it.each([4, 8, 16, 32])('awards two distinct bronzes in a full %i-entrant bracket', (count) => {
    const graph = draw(count);
    const resolution = resolveDraw(graph, playThrough(graph));
    const bronze = resolution.podium?.bronzeRegistrationIds ?? [];

    expect(bronze).toHaveLength(2);
    expect(new Set(bronze).size).toBe(2);
    expect(bronze).not.toContain(resolution.podium?.goldRegistrationId);
    expect(bronze).not.toContain(resolution.podium?.silverRegistrationId);
  });

  it.each([3, 5, 6, 7, 9, 12, 17])(
    'never awards the same athlete twice in an under-filled %i-entrant bracket',
    (count) => {
      const graph = draw(count);
      const resolution = resolveDraw(graph, playThrough(graph));
      const podium = resolution.podium;

      if (podium === null) return;

      const everyone = [
        podium.goldRegistrationId,
        ...(podium.silverRegistrationId === null ? [] : [podium.silverRegistrationId]),
        ...podium.bronzeRegistrationIds,
      ];

      expect(new Set(everyone).size).toBe(everyone.length);
      expect(podium.bronzeRegistrationIds.length).toBeLessThanOrEqual(2);
    },
  );
});

describe('repechage — integration with the bracket', () => {
  it('puts repechage matches in their own round, after the final', () => {
    const graph = draw(8);
    const last = graph.rounds.at(-1);

    expect(last?.name).toBe(REPECHAGE_ROUND_NAME);
    expect(graph.rounds.at(-2)?.name).toBe('Final');
  });

  it('keeps the main bracket unchanged', () => {
    const graph = draw(8);
    const main = graph.matches.filter((match) => match.bracketType === 'MAIN');

    expect(main).toHaveLength(7);
    // No bronze bout leaks into the main bracket.
    expect(main.every((match) => match.roundName !== REPECHAGE_ROUND_NAME)).toBe(true);
  });

  it('never puts an entrant directly into a repechage slot', () => {
    const graph = draw(16);

    const repechageSlots = graph.slots.filter((slot) => slot.slotType === 'REPECHAGE');
    expect(repechageSlots.length).toBeGreaterThan(0);
    expect(repechageSlots.every((slot) => slot.registrationId === null)).toBe(true);
  });

  it('leaves the repechage pending until both semi-finals are decided', () => {
    const graph = draw(8);
    const resolution = resolveDraw(graph, new Map());

    const ancillary = resolution.matches.filter((match) => match.bracketType !== 'MAIN');
    expect(ancillary.every((match) => match.status === 'PENDING')).toBe(true);
  });

  it('is deterministic, like the rest of the draw', () => {
    expect(draw(8).checksum).toBe(draw(8).checksum);
    expect(draw(8, { bronzeMedals: 1 }).checksum).not.toBe(draw(8, { bronzeMedals: 2 }).checksum);
  });

  it('ends at the final when no bronze is awarded', () => {
    const graph = draw(8, { bronzeMedals: 0 });

    expect(graph.rounds.at(-1)?.name).toBe('Final');
    expect(graph.rounds.some((round) => round.name === REPECHAGE_ROUND_NAME)).toBe(false);
  });

  it('still resolves gold and silver when no bronze is awarded', () => {
    const resolution = resolveDraw(draw(8, { bronzeMedals: 0 }), playThrough(draw(8, { bronzeMedals: 0 })));

    expect(resolution.podium?.goldRegistrationId).toBe('p1');
    expect(resolution.podium?.silverRegistrationId).toBe('p2');
    expect(resolution.podium?.bronzeRegistrationIds ?? []).toEqual([]);
  });

  it('does not disturb gold and silver', () => {
    const resolution = resolveDraw(draw(8), playThrough(draw(8)));

    expect(resolution.podium?.goldRegistrationId).toBe('p1');
    expect(resolution.podium?.silverRegistrationId).toBe('p2');
  });
});
