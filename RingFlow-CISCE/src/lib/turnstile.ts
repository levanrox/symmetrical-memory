/**
 * Whether Cloudflare Turnstile verification is enforced.
 *
 * The event server is designed to run on an offline LAN, where reaching
 * Cloudflare's siteverify endpoint is impossible. Verification therefore
 * defaults to OFF and must be explicitly enabled with
 * TURNSTILE_ENABLED=true (plus TURNSTILE_SECRET_KEY).
 *
 * Lives here — NOT in `src/actions/turnstile.ts` — because Next.js requires
 * every export of a `"use server"` module to be an async function, and a
 * synchronous export breaks `next build`.
 */
export function turnstileEnabled(): boolean {
  return process.env.TURNSTILE_ENABLED === "true";
}
