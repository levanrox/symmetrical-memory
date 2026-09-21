/**
 * Signed session cookies.
 *
 * Before this module, the app stored the *raw* admin UUID in `admin_session`
 * (and the XSS-readable `admin_dev_id`) — cookie possession alone meant
 * "admin". Now every session cookie value is HMAC-SHA256 signed with
 * SESSION_SECRET, so a tampered or forged cookie is rejected instead of
 * trusted.
 *
 * Format: "<value>.<hex-signature>". Values must not contain dots — UUIDs
 * (the only session values used) never do.
 *
 * Server-only: imports node:crypto. Never import from client components.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

function sessionSecret(): string {
  const explicit = process.env.SESSION_SECRET;
  if (explicit) return explicit;
  // In production an explicit SESSION_SECRET is required: silently falling
  // back to the realtime-shared SECRET_KEY_BASE would couple cookie forgery
  // to a different secret's lifetime. Fail loudly instead. (Development may
  // still fall back for convenience.)
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not set. Generate one with `node scripts/gen-supabase-secrets.mjs` " +
        "or `openssl rand -hex 32`, and add it to .env (see .env.example). " +
        "Refusing to issue session cookies without an explicit secret in production."
    );
  }
  const fallback = process.env.SECRET_KEY_BASE;
  if (!fallback) {
    throw new Error(
      "SESSION_SECRET is not set. Generate one with `openssl rand -hex 32` " +
        "and add it to .env (see .env.example). Refusing to issue unsigned session cookies."
    );
  }
  return fallback;
}

/**
 * Fail-fast startup check: call once when the server boots so a missing
 * SESSION_SECRET crashes the process immediately instead of surfacing as
 * mysterious login failures on first use.
 */
export function assertSessionSecretConfigured(): void {
  sessionSecret();
}

/** The raw session secret (server-only). Also seeds the live-event signing key. */
export function getSessionSecret(): string {
  return sessionSecret();
}

/** Sign a cookie value. Throws if the value contains a dot. */
export function signCookieValue(value: string): string {
  if (!value || value.includes(".")) {
    throw new Error("Cannot sign an empty cookie value or one containing '.'");
  }
  const sig = createHmac("sha256", sessionSecret()).update(value, "utf8").digest("hex");
  return `${value}.${sig}`;
}

/**
 * Verify a signed cookie value. Returns the original value when the signature
 * is valid, otherwise null. Comparison is constant-time. Unsigned legacy
 * values (no dot) are rejected — holders must sign in again after deploy.
 */
export function verifyCookieValue(signed: string | undefined | null): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0 || dot === signed.length - 1) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);

  let expected: string;
  try {
    expected = createHmac("sha256", sessionSecret()).update(value, "utf8").digest("hex");
  } catch {
    return null;
  }

  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? value : null;
}
