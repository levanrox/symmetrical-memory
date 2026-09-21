"use client";

import { RealtimeClient } from "@supabase/realtime-js";

/**
 * Browser-side Supabase Realtime client — one shared WebSocket connection per
 * page, no matter how many screens subscribe.
 *
 * Authenticates with the public anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`),
 * which is safe to expose: realtime events are change *notifications* only,
 * and every data re-read still goes through the application's own
 * session-authenticated server actions.
 */

const globalForBrowserClient = globalThis as unknown as {
  ringflowBrowserRealtime?: RealtimeClient | null;
};

/**
 * Map an http(s):// URL to its ws(s):// equivalent. Browsers throw on
 * `new WebSocket("http://…")` — the scheme MUST be ws/wss. Passes through
 * anything that isn't http(s) (e.g. an already-correct ws:// URL).
 * Exported for unit tests.
 */
export function mapToWsScheme(url: string): string {
  return url.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
}

function resolveSocketUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_REALTIME_URL?.replace(/\/+$/, "");
  // The documented form is http://<lan-ip>:4000 — translate the scheme.
  if (explicit) return `${mapToWsScheme(explicit)}/socket`;
  if (typeof window !== "undefined") {
    // Event deployments run the app and Realtime on the same LAN server, so
    // follow the page's host — no rebuild needed when the server IP changes.
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${window.location.hostname}:4000/socket`;
  }
  return null;
}

/** Returns the shared client, or null when realtime is not configured. */
export function getBrowserRealtimeClient(): RealtimeClient | null {
  if (typeof window === "undefined") return null;
  if (globalForBrowserClient.ringflowBrowserRealtime === undefined) {
    const url = resolveSocketUrl();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.warn(
        "[realtime] live updates are disabled: set NEXT_PUBLIC_REALTIME_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      globalForBrowserClient.ringflowBrowserRealtime = null;
    } else {
      // Reconnect supervisor: realtime-js auto-reconnects, but the defaults
      // are tuned for cloud use. On an event LAN (flaky AP roaming, tablets
      // waking from sleep) we want a steady heartbeat and jittered
      // exponential backoff so a stampede of clients doesn't hammer the
      // server the moment the AP comes back.
      globalForBrowserClient.ringflowBrowserRealtime = new RealtimeClient(url, {
        params: { apikey: anonKey },
        heartbeatIntervalMs: 15_000,
        reconnectAfterMs: (tries) =>
          Math.min(1_000 * 2 ** Math.min(tries, 5), 30_000) * (0.5 + Math.random() * 0.5),
      });
    }
  }
  return globalForBrowserClient.ringflowBrowserRealtime;
}
