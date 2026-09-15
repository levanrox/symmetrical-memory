import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from the standard library.
 *
 * Deliberately not bcrypt: scrypt is memory-hard, is built into Node, and
 * avoids a native dependency on a box that has to be installable offline.
 *
 * Kept out of `auth.ts` so that scripts which only need to hash a password —
 * the seed script, for one — do not pull in the Nest container.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, expectedHex] = stored.split('$');

  if (scheme !== 'scrypt' || saltHex === undefined || expectedHex === undefined) {
    return false;
  }

  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(expectedHex, 'hex');

  // Length check first: timingSafeEqual throws on a length mismatch.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
