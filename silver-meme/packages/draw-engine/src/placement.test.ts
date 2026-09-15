import { describe, expect, it } from 'vitest';
import { buildEliminationBracket } from './placement';
import type { Participant, SlotNode } from './types';

function participant(id: string): Participant {
  return { registrationId: id, displayName: id.toUpperCase(), clubId: 'club-a', districtId: 'd1' };
}

/** Seeds 1..count filled, higher seed numbers left absent (= byes). */
function seedMap(count: number): Map<number, Participant> {
  const map = new Map<number, Participant>();
  for (let seed = 1; seed <= count; seed += 1) {
    map.set(seed, participant(`p${seed}`));
  }
  return map;
}

function slotsOf(slots: readonly SlotNode[], matchId: string): SlotNode[] {
  return slots.filter((slot) => slot.matchId === matchId);
}

describe('buildEliminationBracket — structure', () => {
  it('builds size-1 matches for a full bracket', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);

    expect(build.matches).toHaveLength(7);
    expect(build.rounds).toHaveLength(3);
  });

  it('distributes matches across rounds as the bracket halves', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);

    expect(build.rounds.map((round) => round.matchIds.length)).toEqual([4, 2, 1]);
  });

  it('names the rounds from the final backwards', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);

    expect(build.rounds.map((round) => round.name)).toEqual([
      'Quarter-final',
      'Semi-final',
      'Final',
    ]);
  });

  it('numbers matches sequentially from 1', () => {
    const build = buildEliminationBracket('cat', seedMap(16), 16);

    expect(build.matches.map((match) => match.matchNo)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
  });

  it('marks every match as a main-bracket match', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);

    expect(build.matches.every((match) => match.bracketType === 'MAIN')).toBe(true);
    expect(build.matches.every((match) => match.poolId === null)).toBe(true);
  });

  it('gives every match exactly two slots', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);

    for (const match of build.matches) {
      expect(slotsOf(build.slots, match.id), match.id).toHaveLength(2);
    }
  });

  it('produces unique match and slot identifiers', () => {
    const build = buildEliminationBracket('cat', seedMap(16), 16);

    expect(new Set(build.matches.map((m) => m.id)).size).toBe(build.matches.length);
    expect(new Set(build.slots.map((s) => s.id)).size).toBe(build.slots.length);
  });

  it('derives identifiers deterministically from the category', () => {
    const first = buildEliminationBracket('cat', seedMap(8), 8);
    const second = buildEliminationBracket('cat', seedMap(8), 8);

    expect(first.matches.map((m) => m.id)).toEqual(second.matches.map((m) => m.id));
    expect(first.slots.map((s) => s.id)).toEqual(second.slots.map((s) => s.id));
  });
});

describe('buildEliminationBracket — entrant and bye placement', () => {
  it('places every entrant exactly once', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);

    const placed = build.slots
      .filter((slot) => slot.slotType === 'ATHLETE')
      .map((slot) => slot.registrationId);

    expect(placed).toHaveLength(8);
    expect(new Set(placed).size).toBe(8);
  });

  it('turns absent seeds into byes', () => {
    const build = buildEliminationBracket('cat', seedMap(5), 8);

    const athletes = build.slots.filter((slot) => slot.slotType === 'ATHLETE');
    const byes = build.slots.filter((slot) => slot.slotType === 'BYE');

    expect(athletes).toHaveLength(5);
    expect(byes).toHaveLength(3);
  });

  it('gives the byes to the strongest entrants', () => {
    // Five entrants in a bracket of eight: seeds 1, 2 and 3 should be the ones
    // who advance without fighting.
    const build = buildEliminationBracket('cat', seedMap(5), 8);

    const firstRound = build.matches.filter((match) => match.roundNo === 0);
    const seedsWithByes = firstRound
      .map((match) => slotsOf(build.slots, match.id))
      .filter((pair) => pair.some((slot) => slot.slotType === 'BYE'))
      .map((pair) => pair.find((slot) => slot.slotType === 'ATHLETE')?.registrationId);

    expect(new Set(seedsWithByes)).toEqual(new Set(['p1', 'p2', 'p3']));
  });

  it('never pairs two byes against each other when at least half the bracket is filled', () => {
    for (let entrants = 2; entrants <= 16; entrants += 1) {
      const size = Math.pow(2, Math.ceil(Math.log2(Math.max(entrants, 2))));
      const build = buildEliminationBracket('cat', seedMap(entrants), size);

      const doubleByes = build.matches.filter((match) => {
        const pair = slotsOf(build.slots, match.id);
        return pair.every((slot) => slot.slotType === 'BYE');
      });

      if (entrants > size / 2) {
        expect(doubleByes, `entrants=${entrants} size=${size}`).toHaveLength(0);
      }
    }
  });

  it('keeps seed 1 and seed 2 in opposite halves', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);
    // The top half is the first half of the opening round's matches, not all of
    // them: with four opening matches, matches 0-1 are the top half.
    const halfSize = (build.rounds[0]?.matchIds.length ?? 0) / 2;

    const indexOf = (registrationId: string): number => {
      const slot = build.slots.find((s) => s.registrationId === registrationId);
      if (slot === undefined) throw new Error(`${registrationId} not placed`);
      const matchIndex = build.matches.findIndex((m) => m.id === slot.matchId);
      return matchIndex;
    };

    const oneInFirstHalf = indexOf('p1') < halfSize;
    const twoInFirstHalf = indexOf('p2') < halfSize;

    expect(oneInFirstHalf).not.toBe(twoInFirstHalf);
  });
});

describe('buildEliminationBracket — advancement wiring', () => {
  it('fills later rounds with winner references, not athletes', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);

    const laterSlots = build.slots.filter((slot) => {
      const match = build.matches.find((m) => m.id === slot.matchId);
      return match !== undefined && match.roundNo > 0;
    });

    expect(laterSlots.every((slot) => slot.slotType === 'WINNER_OF')).toBe(true);
    expect(laterSlots.every((slot) => slot.registrationId === null)).toBe(true);
  });

  it('has the final fed by the two semifinal winners', () => {
    const build = buildEliminationBracket('cat', seedMap(8), 8);

    const final = build.matches.find((match) => match.roundName === 'Final');
    const semiFinals = build.matches.filter((match) => match.roundName === 'Semi-final');

    expect(final).toBeDefined();
    const finalSlots = slotsOf(build.slots, final?.id ?? '');

    expect(finalSlots.map((slot) => slot.sourceMatchId).sort()).toEqual(
      semiFinals.map((match) => match.id).sort(),
    );
  });

  it('points every match except the final at exactly one downstream slot', () => {
    const build = buildEliminationBracket('cat', seedMap(16), 16);
    const final = build.matches.find((match) => match.roundName === 'Final');

    for (const match of build.matches) {
      const consumers = build.slots.filter((slot) => slot.sourceMatchId === match.id);
      const expected = match.id === final?.id ? 0 : 1;

      expect(consumers, `match ${match.matchNo}`).toHaveLength(expected);
    }
  });

  it('never references a match that does not exist', () => {
    const build = buildEliminationBracket('cat', seedMap(16), 16);
    const known = new Set(build.matches.map((match) => match.id));

    const referenced = build.slots
      .map((slot) => slot.sourceMatchId)
      .filter((id): id is string => id !== null);

    expect(referenced.every((id) => known.has(id))).toBe(true);
  });

  it('every match is reachable from the final by walking winner references', () => {
    const build = buildEliminationBracket('cat', seedMap(16), 16);
    const final = build.matches.find((match) => match.roundName === 'Final');
    const seen = new Set<string>();
    const queue = [final?.id ?? ''];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);

      for (const slot of build.slots.filter((s) => s.matchId === current)) {
        if (slot.sourceMatchId !== null) queue.push(slot.sourceMatchId);
      }
    }

    expect(seen.size).toBe(build.matches.length);
  });
});
