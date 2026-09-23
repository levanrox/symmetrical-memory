/**
 * Name matching helpers for imports: normalisation, a small Levenshtein
 * implementation, and "did you mean …?" suggestions.
 */

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Classic Levenshtein edit distance (iterative, O(n*m) time, O(m) space). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

export type Suggestion<T extends { id: string; name: string }> = T & {
  distance: number;
};

/**
 * "Did you mean …?" — the closest candidates to `query` by edit distance.
 * Candidates further than `maxDistance` are dropped. Ties keep input order.
 */
export function suggestClosest<T extends { id: string; name: string }>(
  query: string,
  candidates: T[],
  limit = 3,
  maxDistance?: number
): Suggestion<T>[] {
  const q = normalizeName(query);
  if (!q) return [];
  const ceiling =
    maxDistance ?? Math.max(3, Math.floor(q.length / 2));
  return candidates
    .map((c) => ({ ...c, distance: levenshtein(q, normalizeName(c.name)) }))
    .filter((s) => s.distance <= ceiling)
    .sort((x, y) => x.distance - y.distance)
    .slice(0, limit);
}

/** Case/whitespace-insensitive exact lookup. */
export function findExact<T extends { name: string }>(
  query: string,
  candidates: T[]
): T | null {
  const q = normalizeName(query);
  if (!q) return null;
  return candidates.find((c) => normalizeName(c.name) === q) ?? null;
}
