import { randomBytes } from 'node:crypto';

/**
 * UUID v7 — time-ordered, generated at the edge.
 *
 * Postgres indexes these far better than v4 because the leading bits are a
 * timestamp, and because the id is produced client-side no round trip is needed
 * to obtain one. 48 bits of milliseconds, then version and variant bits, then
 * random. Good for ~8,900 years, which should cover the tournament.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);

  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes.writeUInt8(0x70 | (bytes.readUInt8(6) & 0x0f), 6);
  bytes.writeUInt8(0x80 | (bytes.readUInt8(8) & 0x3f), 8);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
