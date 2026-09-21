import { headers } from "next/headers";

/**
 * A `Secure` cookie is silently dropped by the browser over plain HTTP, which
 * breaks LAN deployments (venue laptops talking to a local server). Decide from
 * the actual request protocol instead of NODE_ENV.
 *
 * Precedence:
 * 1. `COOKIE_SECURE=true|false` — explicit deployment override (use `true`
 *    when the app is served over HTTPS, e.g. behind a TLS reverse proxy).
 * 2. `x-forwarded-proto` — only meaningful behind a proxy; on direct LAN
 *    connections a client could spoof this header, but the worst case is
 *    they break their own login (a Secure cookie is never sent back over
 *    plain HTTP), so no privilege is gained.
 * 3. Default `false` — the event LAN is plain HTTP by default.
 */
export async function secureCookieFlag(): Promise<boolean> {
  const override = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  try {
    const headersList = await headers();
    const proto = headersList.get("x-forwarded-proto");
    if (proto) return proto.split(",")[0].trim() === "https";
    return false;
  } catch {
    return false;
  }
}
