import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted, `undefined` dropped, arrays in order.
 *
 * The checksum is only meaningful if two structurally identical graphs
 * serialise to the same bytes, so key insertion order must never leak in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort();

    const result: Record<string, unknown> = {};
    for (const key of keys) {
      result[key] = canonicalize(source[key]);
    }
    return result;
  }

  return value;
}

/**
 * SHA-256 over the canonical form of a value.
 *
 * Used to detect that a draw changed, and to let a printed sheet be checked
 * against the locked version. It is change detection, not a security boundary.
 */
export function checksumOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
