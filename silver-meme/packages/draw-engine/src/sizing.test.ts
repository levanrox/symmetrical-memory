import { describe, expect, it } from 'vitest';
import {
  byeCount,
  matchIdFor,
  mustGet,
  nextPowerOfTwo,
  roundName,
  seedPositions,
  slotIdFor,
  totalRounds,
} from './sizing';

describe('nextPowerOfTwo', () => {
  it.each([
    [1, 2],
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [8, 8],
    [9, 16],
    [16, 16],
    [17, 32],
    [32, 32],
    [33, 64],
  ])('sizes %i entrants to a bracket of %i', (entrants, expected) => {
    expect(nextPowerOfTwo(entrants)).toBe(expected);
  });

  it('always returns a power of two', () => {
    for (let n = 1; n <= 130; n += 1) {
      const size = nextPowerOfTwo(n);
      expect(Math.log2(size) % 1, `size ${size} for n=${n}`).toBe(0);
      expect(size).toBeGreaterThanOrEqual(n);
    }
  });
});

describe('byeCount', () => {
  it.each([
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 0],
    [5, 3],
    [5, 3],
    [8, 0],
    [17, 15],
  ])('gives %i entrants %i bye(s)', (entrants, expected) => {
    expect(byeCount(entrants)).toBe(expected);
  });

  it('is never negative and always fills the bracket exactly', () => {
    for (let n = 1; n <= 64; n += 1) {
      const byes = byeCount(n);
      expect(byes).toBeGreaterThanOrEqual(0);
      expect(n + byes).toBe(nextPowerOfTwo(n));
    }
  });
});

describe('seedPositions', () => {
  it('places seeds for a two-entrant bracket', () => {
    expect(seedPositions(2)).toEqual([1, 2]);
  });

  it('places seeds for a four-entrant bracket', () => {
    expect(seedPositions(4)).toEqual([1, 4, 2, 3]);
  });

  it('places seeds for an eight-entrant bracket', () => {
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('contains every seed exactly once', () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const positions = seedPositions(size);
      expect([...positions].sort((a, b) => a - b)).toEqual(
        Array.from({ length: size }, (_, i) => i + 1),
      );
    }
  });

  it('keeps seed 1 and seed 2 in opposite halves so they can only meet in the final', () => {
    for (const size of [4, 8, 16, 32]) {
      const positions = seedPositions(size);
      const half = size / 2;
      const indexOfOne = positions.indexOf(1);
      const indexOfTwo = positions.indexOf(2);

      const sameHalf = indexOfOne < half === indexOfTwo < half;
      expect(sameHalf, `size ${size}`).toBe(false);
    }
  });

  it('keeps seeds 1 and 3 apart until the semifinals at the earliest', () => {
    const size = 16;
    const positions = seedPositions(size);
    const quarterSize = size / 4;
    const quarterOfOne = Math.floor(positions.indexOf(1) / quarterSize);
    const quarterOfThree = Math.floor(positions.indexOf(3) / quarterSize);

    expect(quarterOfOne).not.toBe(quarterOfThree);
  });
});

describe('totalRounds', () => {
  it.each([
    [2, 1],
    [4, 2],
    [8, 3],
    [16, 4],
    [32, 5],
  ])('needs %i rounds for a bracket of %i', (size, expected) => {
    expect(totalRounds(size)).toBe(expected);
  });
});

describe('roundName', () => {
  it.each([
    [1, 'Final'],
    [2, 'Semi-final'],
    [4, 'Quarter-final'],
    [8, 'Round of 16'],
    [16, 'Round of 32'],
  ])('names a round with %i matches "%s"', (matchesInRound, expected) => {
    expect(roundName(matchesInRound)).toBe(expected);
  });
});

describe('identifier derivation', () => {
  it('derives match ids from the category and match number', () => {
    expect(matchIdFor('cat-1', 7)).toBe('cat-1:M7');
  });

  it('derives slot ids from the match id and position', () => {
    expect(slotIdFor('cat-1:M7', 1)).toBe('cat-1:M7:S1');
    expect(slotIdFor('cat-1:M7', 2)).toBe('cat-1:M7:S2');
  });

  it('produces the same ids for the same inputs, so a redraw is comparable', () => {
    expect(matchIdFor('cat-1', 3)).toBe(matchIdFor('cat-1', 3));
  });
});

describe('mustGet', () => {
  it('returns the element when present', () => {
    expect(mustGet(['a', 'b'], 1, 'letter')).toBe('b');
  });

  it('throws rather than returning undefined', () => {
    expect(() => mustGet(['a'], 5, 'letter')).toThrow(/letter is missing at index 5/);
  });
});
