/**
 * Server-side publisher: relays LiveEvents to the self-hosted Supabase
 * Realtime server over a single shared WebSocket connection.
 *
 * Server-only: authenticates with SUPABASE_SERVICE_ROLE_KEY, which must never
 * reach the browser. Browsers subscribe with the public anon key instead.
 *
 * Publishing is fire-and-forget for callers — a failure only logs, because the
 * database (not the event stream) is the source of truth and every screen can
 * refetch its state.
 */

import { RealtimeClient, type RealtimeChannel } from "@supabase/realtime-js";
import { LIVE_CHANNEL_TOPIC, type LiveEvent } from "./events";
import { signLiveEvent } from "./eventSigning";
import { logger } from "@/lib/logger";
import { liveEventsPublished } from "@/lib/metrics";

const SUBSCRIBE_TIMEOUT_MS = 10_000;

const globalForPublisher = globalThis as unknown as {
  ringflowRealtimeClient?: RealtimeClient;
  ringflowRealtimeChannel?: Promise<RealtimeChannel> | null;
  ringflowRealtimeWarned?: boolean;
};

function socketUrl(): string {
  // Inside docker compose the Realtime container is reachable as
  // `http://realtime:4000`; when the app runs on the host directly it is
  // `http://localhost:4000`.
  const base = (process.env.REALTIME_URL || "http://localhost:4000").replace(/\/+$/, "");
  return `${base}/socket`;
}

function warnOnce(message: string): void {
  if (globalForPublisher.ringflowRealtimeWarned) return;
  globalForPublisher.ringflowRealtimeWarned = true;
  logger.warn(`[realtime] ${message}`);
}

function getClient(): RealtimeClient | null {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    warnOnce("SUPABASE_SERVICE_ROLE_KEY is not set; live event publishing is disabled.");
    return null;
  }
  if (!globalForPublisher.ringflowRealtimeClient) {
    globalForPublisher.ringflowRealtimeClient = new RealtimeClient(socketUrl(), {
      params: { apikey: serviceRoleKey },
    });
  }
  return globalForPublisher.ringflowRealtimeClient;
}

function getChannel(client: RealtimeClient): Promise<RealtimeChannel> {
  if (!globalForPublisher.ringflowRealtimeChannel) {
    globalForPublisher.ringflowRealtimeChannel = new Promise<RealtimeChannel>((resolve, reject) => {
      let settled = false;
      const channel = client.channel(LIVE_CHANNEL_TOPIC);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        globalForPublisher.ringflowRealtimeChannel = null;
        reject(new Error("timed out joining the live channel"));
      }, SUBSCRIBE_TIMEOUT_MS);
      channel.subscribe((status) => {
        if (settled) return;
        if (status === "SUBSCRIBED") {
          settled = true;
          clearTimeout(timer);
          resolve(channel);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          settled = true;
          clearTimeout(timer);
          globalForPublisher.ringflowRealtimeChannel = null;
          reject(new Error(`could not join the live channel (${status})`));
        }
        // CLOSED before SUBSCRIBED just means "try again later"; the next
        // publish re-subscribes from scratch.
      });
    });
  }
  return globalForPublisher.ringflowRealtimeChannel;
}

/**
 * Broadcast one LiveEvent to every subscribed screen. Never throws; drops and
 * logs on failure so a realtime outage can never break a mutation.
 *
 * The event is Ed25519-signed here — the single choke point for all
 * server-originated broadcasts (direct server-action broadcasts and the
 * NOTIFY bridge both flow through this function) — so browsers can reject
 * forged events before scope matching.
 */
export async function publishLiveEvent(event: LiveEvent): Promise<void> {
  const client = getClient();
  if (!client) return;
  let signed: LiveEvent;
  try {
    signed = signLiveEvent(event);
  } catch (err) {
    logger.error({ err }, "[realtime] could not sign live event; dropping");
    return;
  }
  try {
    const channel = await getChannel(client);
    const result = await channel.send({ type: "broadcast", event: "change", payload: signed });
    if (result !== "ok") {
      throw new Error(`broadcast not acknowledged (got "${result}")`);
    }
    liveEventsPublished.inc();
  } catch (err) {
    // Forget the channel so the next event re-subscribes from scratch.
    globalForPublisher.ringflowRealtimeChannel = null;
    warnOnce(`could not publish a live event; will keep retrying. (${err})`);
  }
}
