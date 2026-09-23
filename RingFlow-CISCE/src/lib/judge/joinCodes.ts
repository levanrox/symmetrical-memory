/**
 * Judge join-code plumbing (P3) — pure helpers, no DB, no Next.js.
 *
 * Judges are numbered SEATS, not identities. A join code is a short,
 * typeable credential that only creates a *pending* request; the moderator
 * approves it before any session exists, so a leaked code is a nuisance
 * (spam pending requests, rate-limited) rather than a breach.
 */

/** Unambiguous alphabet: no 0/O/1/I/L (and no 0/1 confusion at all). */
export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const JOIN_CODE_LENGTH = 6;
/** Default code lifetime: 24h (covers the event day plus teardown). */
export const JOIN_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** Injectable entropy source: (bytes needed) => random bytes. */
export type RandomBytes = (n: number) => Uint8Array;

function defaultRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

/**
 * Generate one join-code value.
 *
 * 32 symbols, one byte per char: 32 divides 256 evenly so `byte % 32` is
 * bias-free. 6 chars x 5 bits = 30 bits of CSPRNG entropy; uniqueness is
 * enforced by the DB unique constraint with a retry loop on collision.
 */
export function generateJoinCodeValue(rand: RandomBytes = defaultRandomBytes): string {
  const bytes = rand(JOIN_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    const b = bytes[i];
    if (b === undefined) throw new Error("Random source returned too few bytes");
    code += JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

/** Default expiry for a freshly issued code. */
export function defaultJoinCodeExpiry(now: number = Date.now()): Date {
  return new Date(now + JOIN_CODE_TTL_MS);
}

/** Normalise user-typed codes: uppercase, strip spaces/dashes/underscores. */
export function normalizeJoinCodeInput(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/[\s\-_]/g, "") : "";
}

/** True when the code can no longer be used (missing expiry counts as expired). */
export function isJoinCodeExpired(
  expiresAt: Date | string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= now;
}

/**
 * Sanitize a judge's display name: strip control chars, trim, require
 * 1-40 chars. Returns null when the name is unusable.
 */
export function sanitizeJudgeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (stripped.length < 1 || stripped.length > 40) return null;
  return stripped;
}

/**
 * Lowest free seat in 1..panelSize, or null when the panel is full.
 * Out-of-range / non-integer occupied entries are ignored defensively.
 */
export function lowestFreeSeat(
  occupied: readonly (number | null | undefined)[],
  panelSize: number
): number | null {
  const taken = new Set<number>();
  for (const s of occupied) {
    if (Number.isInteger(s) && (s as number) >= 1 && (s as number) <= panelSize) {
      taken.add(s as number);
    }
  }
  for (let seat = 1; seat <= panelSize; seat += 1) {
    if (!taken.has(seat)) return seat;
  }
  return null;
}

/**
 * Panel size for a kata category. An explicit positive `kata_panel_size`
 * wins; otherwise 7 when the format involves round-robin groups, else 5.
 */
export function resolvePanelSize(
  kataPanelSize: number | null | undefined,
  kataFormat: string | null | undefined
): number {
  if (Number.isInteger(kataPanelSize) && (kataPanelSize as number) > 0) {
    return kataPanelSize as number;
  }
  const f = (kataFormat ?? "").toUpperCase();
  if (f === "GROUPS_THEN_ELIMINATION" || f === "ROUND_ROBIN") return 7;
  return 5;
}
