import { db } from "@/db";
import { sql } from "drizzle-orm";
import { connect } from "node:net";
import { logger } from "@/lib/logger";

/**
 * Liveness: "is the app process able to serve traffic?"
 * Used as the Docker HEALTHCHECK. Fails (503) when the DB pool or the
 * Realtime socket is unreachable.
 */

/** TCP connect probe — the realtime server has no unauthenticated HTTP
 * health endpoint, so a socket connect is the honest reachability signal. */
function tcpReachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(ok);
    };
    const socket = connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export async function GET() {
  const checks: Record<string, string> = {};
  let ok = true;

  try {
    await db.execute(sql`select 1`);
    checks.database = "ok";
  } catch (err) {
    ok = false;
    checks.database = "unreachable";
    logger.error({ err }, "[health] database check failed");
  }

  try {
    const base = (process.env.REALTIME_URL || "http://realtime:4000").replace(/\/+$/, "");
    const url = new URL(base);
    const port = url.port ? Number(url.port) : 4000;
    const reachable = await tcpReachable(url.hostname, port, 3000);
    if (!reachable) throw new Error("tcp connect failed");
    checks.realtime = "ok";
  } catch {
    ok = false;
    checks.realtime = "unreachable";
  }

  return Response.json(
    { status: ok ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  );
}
