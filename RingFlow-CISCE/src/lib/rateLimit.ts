/**
 * Minimal in-memory per-key rate limiter for brute-force-sensitive actions
 * (access-code attempts, login attempts).
 *
 * Server-only: uses next/headers. This is a single-instance token bucket —
 * correct for the event deployment (one app container). It is NOT a
 * distributed limiter; do not rely on it if the app is ever scaled
 * horizontally.
 *
 * IP resolution (P9 H-3/M-1): buckets are keyed on the identity resolved by
 * resolveRateLimitIdentity() in src/lib/judgeAccess.ts — the trusted
 * `x-rf-peer` header stamped by server.mjs, or the judge's real client IP
 * (`CF-Connecting-IP`) on the tunnel path. `X-Forwarded-For` is NEVER read:
 * on direct LAN connections browsers send none (everyone used to share one
 * "unknown" bucket and the 11th judge got a 429 at event start), and through
 * the tunnel its leading entries are client-controlled (rotating the header
 * used to mint a fresh bucket per request).
 *
 * When no peer IP is verifiable (app not running under server.mjs), the
 * limiter FAILS OPEN on a generous shared budget rather than lumping all
 * clients into a tight per-IP bucket: a missing header must not self-DoS
 * event traffic, and per-IP limits are inherently coarse behind venue WiFi
 * NAT anyway.
 */
import { headers } from "next/headers";
import { resolveRateLimitIdentity } from "./judgeAccess";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map can't grow without bound.
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Multiplier applied to `limit` for the shared fallback bucket used when no
 * peer IP is verifiable. Generous on purpose: with no trustworthy client
 * identity, blocking event traffic is worse than a looser global cap.
 * (P9 H-3: fail open, documented.)
 */
export const UNKNOWN_IP_LIMIT_MULTIPLIER = 20;

/**
 * Best-effort client IP for rate-limit keys. Returns null when no peer IP is
 * verifiable — callers must fail open (see checkIpRateLimit).
 */
export async function rateLimitIp(): Promise<string | null> {
  try {
    const h = await headers();
    const identity = resolveRateLimitIdentity(h);
    return identity.ip;
  } catch {
    return null;
  }
}

/**
 * Throws when `key` has exceeded `limit` attempts in the last `windowMs`.
 * Counts the current attempt — call BEFORE doing the expensive/checked work.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new Error("Too many attempts. Please wait a minute and try again.");
  }
}

/**
 * Rate-limit the caller's IP for a named action.
 *
 * Fail-open (P9 H-3): when the peer IP can't be determined, all clients share
 * one bucket with a generous budget (`limit * UNKNOWN_IP_LIMIT_MULTIPLIER`)
 * instead of sharing a tight per-IP budget that would 429 legitimate users.
 */
export async function checkIpRateLimit(action: string, limit: number, windowMs: number): Promise<void> {
  const ip = await rateLimitIp();
  if (ip === null) {
    checkRateLimit(
      `${action}:shared-unknown-ip`,
      limit * UNKNOWN_IP_LIMIT_MULTIPLIER,
      windowMs
    );
    return;
  }
  checkRateLimit(`${action}:${ip}`, limit, windowMs);
}
