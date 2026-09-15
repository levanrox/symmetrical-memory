import { getRuleset, type Ruleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { generateDraw } from './generate';
import { resolveDraw, type MatchOutcome, type ResolvedMatch } from './resolution';
import type { DrawGraph, Participant } from './types';

const ruleset: Ruleset = getRuleset('WKF_KUMITE_2026');

function participant(id: string): Participant {
  return { registrationId: id, displayName: id.toUpperCase(), clubId: `club-${id}`, districtId: `d-${id}` };
}

function entrants(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => participant(`p${i + 1}`));
}

function draw(n: number): DrawGraph {
  return generateDraw(
    { categoryId: 'cat-1', format: 'SINGLE_ELIM_REPECHAGE', participants: entrants(n), seeding: { mode: 'NONE' } },
    ruleset,
  );
}

function inSlotOrder(match: ResolvedMatch): [string, string] {
  const first = match.slots.find((slot) => slot.position === 1)?.registrationId;
  const second = match.slots.find((slot) => slot.position === 2)?.registrationId;

  if (first === null || first === undefined || second === null || second === undefined) {
    throw new Error(`match ${match.matchId} does not have two athletes`);
  }

  return [first, second];
}

/** Plays a category to completion, always letting the top line (AKA) win. */
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

describe('resolveDraw — before any results', () => {
  it('marks the opening round ready and later rounds pending', () => {
    const graph = draw(8);
    const resolution = resolveDraw(graph, new Map());

    const mainOnly = resolution.matches.filter((match) => match.bracketType === 'MAIN');

    const ready = mainOnly.filter((match) => match.status === 'READY');
    expect(ready).toHaveLength(4);
    expect(ready.every((match) => match.roundNo === 0)).toBe(true);

    // First round played, semi-finals and final wait on it.
    expect(mainOnly.filter((match) => match.status === 'PENDING')).toHaveLength(3);
  });

  it('leaves every repechage and bronze match pending until the semi-finals are done', () => {
    const graph = draw(8);
    const resolution = resolveDraw(graph, new Map());

    const ancillary = resolution.matches.filter((match) => match.bracketType !== 'MAIN');

    expect(ancillary.length).toBeGreaterThan(0);
    expect(ancillary.every((match) => match.status === 'PENDING')).toBe(true);
  });

  it('reports no podium before the final is decided', () => {
    expect(resolveDraw(draw(8), new Map()).podium).toBeNull();
  });

  it('reports no problems for a clean bracket', () => {
    expect(resolveDraw(draw(8), new Map()).problems).toEqual([]);
  });

  it('leaves a full bracket with no walkovers', () => {
    expect(resolveDraw(draw(8), new Map()).walkoverMatchIds).toEqual([]);
  });
});

describe('resolveDraw — byes', () => {
  it('turns a bye into a walkover and advances the athlete', () => {
    const graph = draw(5);
    const resolution = resolveDraw(graph, new Map());

    // Three byes in the opening round. Of the four remaining matches, only two
    // can be fought yet: the other two each await a winner from a match that is
    // still undecided, so they are PENDING rather than READY.
    expect(resolution.walkoverMatchIds).toHaveLength(3);
    expect(resolution.readyMatchIds).toHaveLength(2);
  });

  it('advances the strongest entrants through their byes', () => {
    const graph = draw(5);
    const resolution = resolveDraw(graph, new Map());

    const advanced = resolution.matches
      .filter((match) => match.status === 'WALKOVER')
      .map((match) => match.winnerRegistrationId);

    expect(new Set(advanced)).toEqual(new Set(['p1', 'p2', 'p3']));
  });

  it('cascades an empty match forward as a bye instead of stalling', () => {
    // A one-entrant category: the sole athlete should walk the whole bracket.
    const graph = draw(1);
    const resolution = resolveDraw(graph, new Map());

    expect(resolution.walkoverMatchIds).toHaveLength(1);
    expect(resolution.podium?.goldRegistrationId).toBe('p1');
    expect(resolution.podium?.silverRegistrationId).toBeNull();
  });

  it('handles a three-entrant bracket', () => {
    const graph = draw(3);
    const resolution = resolveDraw(graph, new Map());

    expect(graph.tournamentSize).toBe(4);
    // One bye, one real opening bout, and a final that waits on that bout.
    expect(resolution.walkoverMatchIds).toHaveLength(1);
    expect(resolution.readyMatchIds).toHaveLength(1);
  });
});

describe('resolveDraw — a completed category', () => {
  it('advances winners round by round until every match is decided', () => {
    const graph = draw(8);
    const results = playThrough(graph);
    const resolution = resolveDraw(graph, results);

    const main = resolution.matches.filter((match) => match.bracketType === 'MAIN');
    expect(main.filter((match) => match.status === 'FINISHED')).toHaveLength(7);

    // The repechage and bronze bouts are played out as well.
    expect(resolution.completedMatchIds).toHaveLength(graph.matches.length);
    expect(resolution.readyMatchIds).toEqual([]);
    expect(resolution.podium).not.toBeNull();
  });

  it('awards gold and silver from the final', () => {
    const graph = draw(8);
    const resolution = resolveDraw(graph, playThrough(graph));

    expect(resolution.podium?.goldRegistrationId).toBe('p1');
    expect(resolution.podium?.silverRegistrationId).toBe('p2');
  });

  it('awards two bronze medals, to two different athletes', () => {
    const graph = draw(8);
    const resolution = resolveDraw(graph, playThrough(graph));

    const bronze = resolution.podium?.bronzeRegistrationIds ?? [];

    expect(bronze).toHaveLength(2);
    expect(new Set(bronze).size).toBe(2);
    // Nobody on the podium twice.
    expect(bronze).not.toContain(resolution.podium?.goldRegistrationId);
    expect(bronze).not.toContain(resolution.podium?.silverRegistrationId);
  });

  it('puts the winner of each match into the next round', () => {
    const graph = draw(4);
    const results = playThrough(graph);
    const resolution = resolveDraw(graph, results);

    const final = resolution.matches.find((match) => match.roundName === 'Final');
    expect(final).toBeDefined();

    expect(inSlotOrder(final as ResolvedMatch)).toEqual(['p1', 'p2']);
  });

  it('completes a 16-entrant category', () => {
    const graph = draw(16);
    const resolution = resolveDraw(graph, playThrough(graph));

    expect(resolution.completedMatchIds).toHaveLength(graph.matches.length);
    expect(resolution.podium?.goldRegistrationId).toBe('p1');
    expect(resolution.podium?.bronzeRegistrationIds).toHaveLength(2);
  });
});

describe('resolveDraw — purity and idempotency', () => {
  it('produces the same output when run twice', () => {
    const graph = draw(8);
    const results = playThrough(graph);

    expect(JSON.stringify(resolveDraw(graph, results))).toEqual(
      JSON.stringify(resolveDraw(graph, results)),
    );
  });

  it('does not mutate the graph', () => {
    const graph = draw(8);
    const before = JSON.stringify(graph);

    resolveDraw(graph, playThrough(graph));

    expect(JSON.stringify(graph)).toBe(before);
  });

  it('re-running resolution does not double-advance anyone', () => {
    const graph = draw(8);
    const results = playThrough(graph);

    const first = resolveDraw(graph, results);
    const second = resolveDraw(graph, results);

    expect(second.completedMatchIds.length).toBe(first.completedMatchIds.length);
    expect(second.podium).toEqual(first.podium);
  });
});

describe('resolveDraw — problems are reported, not thrown', () => {
  it('resolves the winning side to the athlete actually in that slot', () => {
    const graph = draw(4);
    const opening = graph.matches.filter((match) => match.roundNo === 0);
    const first = opening[0];
    if (first === undefined) throw new Error('expected a match');

    const before = resolveDraw(graph, new Map());
    const match = before.matches.find((candidate) => candidate.matchId === first.id);
    if (match === undefined) throw new Error('expected a resolved match');

    const [akaAthlete, aoAthlete] = inSlotOrder(match);

    for (const [side, expected] of [['AKA', akaAthlete], ['AO', aoAthlete]] as const) {
      const after = resolveDraw(graph, new Map([[first.id, { kind: 'WINNER', side }]]));
      const resolved = after.matches.find((candidate) => candidate.matchId === first.id);

      expect(resolved?.winnerRegistrationId, `side ${side}`).toBe(expected);
      expect(resolved?.loserRegistrationId, `side ${side}`).toBe(
        side === 'AKA' ? aoAthlete : akaAthlete,
      );
    }
  });

  it('refuses a draw in an elimination bout (Art. 12.2.5)', () => {
    const graph = draw(2);
    const firstRound = graph.matches[0];
    if (firstRound === undefined) throw new Error('expected a match');

    const resolution = resolveDraw(graph, new Map([[firstRound.id, { kind: 'HIKIWAKE' }]]));

    expect(resolution.problems.map((p) => p.code)).toContain('HIKIWAKE_NOT_ALLOWED');
    expect(resolution.podium).toBeNull();
  });

  it('flags a result recorded for a walkover', () => {
    const graph = draw(1);
    const firstRound = graph.matches[0];
    if (firstRound === undefined) throw new Error('expected a match');

    const resolution = resolveDraw(
      graph,
      new Map([[firstRound.id, { kind: 'WINNER', side: 'AKA' as const }]]),
    );

    expect(resolution.problems.map((p) => p.code)).toContain('RESULT_FOR_UNPLAYED_MATCH');
  });

  it('flags a double disqualification in a medal bout for the referee to decide', () => {
    const graph = draw(2);
    const final = graph.matches[0];
    if (final === undefined) throw new Error('expected a match');

    const resolution = resolveDraw(
      graph,
      new Map([[final.id, { kind: 'DOUBLE_DISQUALIFICATION' }]]),
    );

    expect(resolution.problems.map((p) => p.code)).toContain(
      'DOUBLE_DISQUALIFICATION_IN_MEDAL_BOUT',
    );
    expect(resolution.podium).toBeNull();
  });

  it('advances nobody after a double disqualification in an earlier round (Art. 12.2.11)', () => {
    const graph = draw(4);
    const openingMatches = graph.matches.filter((match) => match.roundNo === 0);
    const [disqualified, contested] = openingMatches;
    if (disqualified === undefined || contested === undefined) {
      throw new Error('expected two opening matches');
    }

    const final = graph.matches.find((match) => match.roundName === 'Final');
    if (final === undefined) throw new Error('expected a final');

    // Both athletes disqualified in one semi: that side advances nobody.
    const afterDisqualification = resolveDraw(
      graph,
      new Map([[disqualified.id, { kind: 'DOUBLE_DISQUALIFICATION' }]]),
    );

    const waitingFinal = afterDisqualification.matches.find((m) => m.matchId === final.id);
    // Still pending, because the other semi has not been fought — we cannot yet
    // know who wins the final by bye.
    expect(waitingFinal?.status).toBe('PENDING');

    // Once the other semi is decided, the final is a walkover: the rules give
    // the next-round opponent the win by bye.
    const withOtherSemi = resolveDraw(
      graph,
      new Map([
        [disqualified.id, { kind: 'DOUBLE_DISQUALIFICATION' }],
        [contested.id, { kind: 'WINNER', side: 'AKA' }],
      ]),
    );

    const resolvedFinal = withOtherSemi.matches.find((m) => m.matchId === final.id);
    expect(resolvedFinal?.status).toBe('WALKOVER');
    expect(withOtherSemi.podium?.goldRegistrationId).not.toBeNull();
  });
});
