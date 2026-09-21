/**
 * Prometheus metrics (server-only).
 *
 * prom-client keeps a process-global default registry; this module defines
 * the app's custom series in one place so routes and the realtime pipeline
 * share them. Scraped at /api/metrics.
 */

import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

/** LiveEvents successfully broadcast to the Realtime channel. */
export const liveEventsPublished = new client.Counter({
  name: "ringflow_live_events_published_total",
  help: "LiveEvents broadcast to the realtime channel",
  registers: [registry],
});

/** 1 while this instance holds the realtime bridge advisory lock, else 0. */
export const realtimeBridgeLeader = new client.Gauge({
  name: "ringflow_realtime_bridge_leader",
  help: "Whether this instance is the realtime bridge leader",
  registers: [registry],
});
