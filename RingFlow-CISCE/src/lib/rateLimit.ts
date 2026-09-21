/**
 * Minimal in-memory per-key rate limiter for brute-force-sensitive actions
 * (access-code attempts, login attempts).
 *
 * Server-only: uses next/headers. This is a single-instance token bucket —
 * correct for the event deployment (one app container). It is NOT a
 * distributed limiter; do not rely on it if the app is ever scaled
 * horizontally.
 */
import { headers } from "next/headers";

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

/** Best-effort client IP for rate-limit keys (LAN deployment). */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
    return "unknown";
  } catch {
    return "unknown";
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

/** Convenience: rate-limit the caller's IP for a named action. */
export async function checkIpRateLimit(action: string, limit: number, windowMs: number): Promise<void> {
  const ip = await clientIp();
  checkRateLimit(`${action}:${ip}`, limit, windowMs);
}
