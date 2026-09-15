/** Reads an element, failing loudly rather than returning undefined. */
export function mustGet<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];

  if (value === undefined) {
    throw new Error(`Internal error: ${label} is missing at index ${index}`);
  }

  return value;
}

/** Smallest power of two greater than or equal to `n`, with a floor of 2. */
export function nextPowerOfTwo(n: number): number {
  if (n <= 2) return 2;

  let size = 2;
  while (size < n) {
    size *= 2;
  }
  return size;
}

/**
 * Number of empty slots in the bracket for a given entrant count.
 *
 * Byes are what let an under-filled category still be drawn as a clean
 * power-of-two bracket, which is the normal case at district level.
 */
export function byeCount(participantCount: number): number {
  return nextPowerOfTwo(participantCount) - participantCount;
}

/**
 * Standard bracket slotting.
 *
 * Returns an array where the index is the bracket position and the value is the
 * seed number that belongs there. Built recursively so that seed 1 and seed 2
 * can only meet in the final, 1 and 3 only in the semifinals, and so on:
 *
 *   size 2 -> [1, 2]
 *   size 4 -> [1, 4, 2, 3]
 *   size 8 -> [1, 8, 4, 5, 2, 7, 3, 6]
 */
export function seedPositions(size: number): number[] {
  let order = [1];

  while (order.length < size) {
    const doubled = order.length * 2;
    const next: number[] = [];

    for (const seed of order) {
      next.push(seed, doubled + 1 - seed);
    }

    order = next;
  }

  return order;
}

/** Number of rounds needed for a bracket of the given size. */
export function totalRounds(size: number): number {
  return Math.round(Math.log2(size));
}

/**
 * Human-readable round name, derived from how many matches the round contains
 * so that "Quarter-final" always means eight competitors remaining.
 */
export function roundName(matchesInRound: number): string {
  if (matchesInRound === 1) return 'Final';
  if (matchesInRound === 2) return 'Semi-final';
  if (matchesInRound === 4) return 'Quarter-final';
  return `Round of ${matchesInRound * 2}`;
}

/** Deterministic, reproducible match and slot identifiers. */
export function matchIdFor(categoryId: string, matchNo: number): string {
  return `${categoryId}:M${matchNo}`;
}

export function slotIdFor(matchId: string, position: 1 | 2): string {
  return `${matchId}:S${position}`;
}
