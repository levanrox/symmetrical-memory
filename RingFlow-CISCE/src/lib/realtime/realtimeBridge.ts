/**
 * One-way bridge: Postgres NOTIFY → Supabase Realtime broadcast.
 *
 * The LISTEN bus (`bus.ts`) already merges the two existing event sources —
 * instant in-memory broadcasts from server actions and durable post-commit
 * NOTIFYs from the `ringflow_notify()` triggers — so the bridge subscribes to
 * the bus and republishes every event to the Realtime channel. No server
 * action needs to change.
 *
 * Server-only: the publisher authenticates with the service-role key.
 */

import { subscribeToLiveEvents } from "./bus";
import { publishLiveEvent } from "./publisher";
import { logger } from "@/lib/logger";

const globalForBridge = globalThis as unknown as {
  ringflowRealtimeBridgeStarted?: boolean;
};

/**
 * Start the bridge exactly once per server process. Safe to call repeatedly
 * (dev HMR, multiple import sites).
 */
export function ensureRealtimeBridge(): void {
  if (globalForBridge.ringflowRealtimeBridgeStarted) return;
  globalForBridge.ringflowRealtimeBridgeStarted = true;

  subscribeToLiveEvents((event) => {
    void publishLiveEvent(event);
  });

  logger.info("[realtime] bridge started: database change events will be broadcast to live screens.");
}
