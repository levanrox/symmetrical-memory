import { EventEmitter } from "node:events";
import postgres from "postgres";
import { type LiveEvent, parseLiveEvent } from "./events";
import { logger } from "@/lib/logger";
import { realtimeBridgeLeader } from "@/lib/metrics";

export { eventMatchesScope, LIVE_CHANNEL_TOPIC } from "./events";
export type { LiveEvent, LiveScope } from "./events";

/**
 * One LISTEN connection per server process, fanning Postgres NOTIFY payloads
 * out to every in-process subscriber (the Supabase Realtime bridge and any
 * legacy consumers).
 *
 * Row changes reach the server through `migration8_realtime_notify.sql`, which
 * raises `ringflow_events` on the tables live screens read. A single connection
 * carries all of them, so any number of open screens costs one database
 * connection rather than one poller per screen.
 *
 * Multi-instance safety: before LISTENing this process takes a Postgres
 * advisory lock (`pg_try_advisory_lock`). Exactly one instance wins and runs
 * the bridge; the others skip LISTEN. Their DB writes still reach screens
 * because the trigger fires NOTIFY on commit and the lock-holder bridges it —
 * the in-memory `broadcastLiveEvent` path is only a zero-latency optimization
 * for the instance that made the write.
 *
 * Connection: LISTEN requires a session-level connection, which a
 * transaction-mode pooler (pgBouncer) cannot provide, so this deliberately
 * bypasses the pool via DATABASE_DIRECT_URL (falling back to DATABASE_URL).
 */

const CHANNEL = "ringflow_events";
// Arbitrary 64-bit key namespacing this app's advisory lock.
// (BigInt literal avoided: tsconfig targets ES2017.)
const BRIDGE_LOCK_KEY = BigInt("8102123456789012345");

type Bus = {
  emitter: EventEmitter;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  subscribers: number;
};

const globalForBus = globalThis as unknown as { ringflowLiveBus?: Bus };

function createBus(): Bus {
  const emitter = new EventEmitter();
  // A screen can hold several subscriptions (a mat page watches rings and
  // assignments); 100 listeners is well past anything real and still warns if
  // something leaks.
  emitter.setMaxListeners(100);

  let sql: ReturnType<typeof postgres> | null = null;
  let listenPromise: Promise<void> | null = null;
  // Set when stop() is called so the onclose handler doesn't reconnect a
  // connection we closed on purpose.
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;

  // Tracks bridge leadership for the ringflow_realtime_bridge_leader gauge.
  const setBridgeLeader = (value: boolean) => {
    realtimeBridgeLeader.set(value ? 1 : 0);
  };

  /** Jittered exponential backoff: 1s, 2s, 4s … capped at 30s. */
  const backoffMs = () =>
    Math.min(1_000 * 2 ** Math.min(consecutiveFailures, 5), 30_000) *
    (0.5 + Math.random() * 0.5);

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = backoffMs();
    logger.warn(
      { delayMs: Math.round(delay), failures: consecutiveFailures },
      "[live] LISTEN connection lost — reconnecting with backoff"
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void start();
    }, delay);
  };

  const start = async () => {
    stopped = false; // a fresh subscribe after a full stop re-arms the bus
    if (sql) return;
    if (listenPromise) return listenPromise;

    // Direct connection: LISTEN is session-scoped and breaks under a
    // transaction-mode pooler. No default credentials: fail loudly instead
    // of silently connecting somewhere unexpected.
    const connectionString =
      process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_DIRECT_URL (or DATABASE_URL) is not set. The realtime LISTEN bridge cannot start."
      );
    }

    listenPromise = (async () => {
      let conn: ReturnType<typeof postgres> | null = null;
      try {
        conn = postgres(connectionString, {
          max: 1,
          idle_timeout: 0,
          // If the TCP connection dies, LISTEN dies with it — the postgres
          // client does not resubscribe for us. Reconnect with backoff.
          // (Not fired for our own conn.end() in stop(): `stopped` guards.)
          onclose: () => {
            if (sql === conn) sql = null;
            setBridgeLeader(false);
            scheduleReconnect();
          },
        });

        // Leader election: only one app instance LISTENs and bridges. The
        // advisory lock is session-scoped, so losing the connection releases
        // it — a reconnecting instance simply re-contends, which gives
        // natural failover if the previous leader died.
        const [lockRow] = await conn.unsafe(
          "select pg_try_advisory_lock($1) as acquired",
          [BRIDGE_LOCK_KEY.toString()]
        );
        if (!lockRow?.acquired) {
          setBridgeLeader(false);
          logger.info(
            "[live] another instance holds the realtime bridge lock — skipping LISTEN"
          );
          await conn.end({ timeout: 5 });
          return;
        }
        setBridgeLeader(true);

        await conn.listen(CHANNEL, (raw: string) => {
          // Strict envelope validation before the event reaches any subscriber.
          const event = parseLiveEvent(safeJsonParse(raw));
          if (event) {
            emitter.emit("event", event);
          } else {
            logger.warn({ raw: raw.slice(0, 200) }, "[live] dropped malformed notification payload");
          }
        });
        sql = conn;
        consecutiveFailures = 0;
        logger.info("[live] realtime bridge active (LISTEN on ringflow_events)");
      } catch (err) {
        consecutiveFailures += 1;
        setBridgeLeader(false);
        if (sql === conn) sql = null;
        if (conn) {
          try {
            await conn.end({ timeout: 5 });
          } catch {}
        }
        // Don't give up: schedule a reconnect instead of degrading to
        // polling forever. Every screen keeps its polling fallback, so a
        // slow reconnect is a degradation, not an outage.
        logger.error({ err }, "[live] LISTEN failed — will retry with backoff");
        scheduleReconnect();
      } finally {
        listenPromise = null;
      }
    })();

    return listenPromise;
  };

  const stop = async () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const conn = sql;
    sql = null;
    if (!conn) return;
    try {
      // Releasing the connection releases the advisory lock with it.
      await conn.end({ timeout: 5 });
      setBridgeLeader(false);
    } catch (err) {
      logger.error({ err }, "[live] could not close the LISTEN connection");
    }
  };

  return { emitter, start, stop, subscribers: 0 };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const bus: Bus = globalForBus.ringflowLiveBus ?? createBus();
if (process.env.NODE_ENV !== "production") globalForBus.ringflowLiveBus = bus;

/**
 * Subscribe to change events. Returns an unsubscribe function; the LISTEN
 * connection is opened on the first subscriber and closed with the last.
 */
export function subscribeToLiveEvents(listener: (event: LiveEvent) => void): () => void {
  bus.subscribers += 1;
  // start() throws fail-fast when no DB URL is configured; catch it here so
  // a misconfigured environment logs instead of producing an unhandled
  // rejection. (The in-memory broadcast path keeps working regardless.)
  bus.start().catch((err) => {
    logger.error({ err }, "[live] could not start LISTEN bus");
  });

  bus.emitter.on("event", listener);

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    bus.emitter.off("event", listener);
    bus.subscribers = Math.max(0, bus.subscribers - 1);
    if (bus.subscribers === 0) void bus.stop();
  };
}

/**
 * Instantly broadcast an event in-memory to all active subscribers
 * without waiting for database roundtrip.
 *
 * Validates the envelope on the publish path: a programming error that
 * builds a malformed event is caught here (log-and-drop) instead of
 * broadcasting garbage that is signed, sent, and then dropped by every
 * client.
 */
export function broadcastLiveEvent(event: LiveEvent): void {
  if (!parseLiveEvent(event)) {
    logger.error({ event }, "[live] dropping malformed live event");
    return;
  }
  try {
    bus.emitter.emit("event", event);
  } catch (err) {
    logger.error({ err }, "[live] broadcast error");
  }
}
