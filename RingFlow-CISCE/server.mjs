#!/usr/bin/env node
/**
 * RingFlow custom Next.js server.
 *
 * Why this exists (P9 H-1/H-3): Next.js middleware and route handlers never
 * see the TCP socket, and `NextRequest.ip` does not exist in Next 16 — so the
 * app cannot learn the real client IP from inside Next alone. The LAN gate
 * (src/proxy.ts) and the rate limiter (src/lib/rateLimit.ts) need the TRUE
 * peer address to be both usable on direct LAN and unspoofable, while
 * `X-Forwarded-For` is fully client-controlled. This server stamps every
 * request with the socket's peer address in a header the app trusts:
 *
 *   x-rf-peer: <socket.remoteAddress>
 *
 * The header is OVERWRITTEN unconditionally, so a client-sent `x-rf-peer`
 * can never spoof it. The proxy and rate limiter read ONLY this header and
 * ignore X-Forwarded-For / X-Real-IP entirely.
 *
 * DEPLOYMENT CONTRACT: RingFlow must be started through this file
 * (`npm run dev` / `npm start` / the Docker image). If the app is ever run
 * via plain `next start`, `x-rf-peer` is absent and the LAN gate FAILS CLOSED
 * (staff pages 404) while the rate limiter fails open on a generous shared
 * budget — both log a warning. See src/proxy.ts and src/lib/rateLimit.ts.
 *
 * Tunnel traffic (scripts/start-judge-tunnel.sh runs cloudflared against
 * localhost:3000) arrives with peer 127.0.0.1, so "private peer" alone would
 * wrongly admit staff pages through the public tunnel. The proxy additionally
 * refuses staff pages when cloudflared markers (CF-Ray / CF-Connecting-IP)
 * are present — see isTunnelRequest() in src/lib/judgeAccess.ts.
 *
 * Usage:
 *   node server.mjs            # production  (needs `npm run build` first)
 *   node server.mjs --dev      # development (HMR, like `next dev`)
 *
 * Env: PORT (default 3000), HOSTNAME (default 0.0.0.0).
 */

import { createServer } from "node:http";
import next from "next";

/** Must match PEER_IP_HEADER in src/lib/judgeAccess.ts. */
const PEER_IP_HEADER = "x-rf-peer";

const dev = process.argv.includes("--dev");
const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";

const app = next({ dev, dir: process.cwd() });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  // Stamp the true peer address. Unconditional overwrite: a client-supplied
  // x-rf-peer value is discarded, so it can never be spoofed.
  const peer = req.socket?.remoteAddress || "";
  if (peer) {
    req.headers[PEER_IP_HEADER] = peer;
  } else {
    delete req.headers[PEER_IP_HEADER];
  }
  handle(req, res);
});

server.listen(port, hostname, () => {
  console.log(
    `[ringflow] ready on http://${hostname}:${port} (${dev ? "development" : "production"})`
  );
  // Startup line stating which mode the LAN gate resolved (P9 H-1): with
  // this server in front, the gate runs on the trusted peer-IP header.
  console.log(
    `[ringflow] lan-gate mode=peer-header — staff pages require a private ${PEER_IP_HEADER}; X-Forwarded-For is ignored`
  );
});
