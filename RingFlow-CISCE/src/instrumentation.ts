/**
 * Runs once when the Next.js server boots (Node.js runtime only).
 *
 * Starts the realtime bridge: Postgres NOTIFY (via the existing LISTEN bus)
 * → Supabase Realtime broadcast → browsers. The bridge is a no-op when the
 * realtime keys are not configured, so the app still runs fine without the
 * Realtime container.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast on missing SESSION_SECRET in production — before serving.
    const { assertSessionSecretConfigured } = await import("./lib/auth/sessionCookies");
    assertSessionSecretConfigured();
    const { ensureRealtimeBridge } = await import("./lib/realtime/realtimeBridge");
    ensureRealtimeBridge();
  }
}
