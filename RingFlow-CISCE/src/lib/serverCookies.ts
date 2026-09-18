import { headers } from "next/headers";

/**
 * A `Secure` cookie is silently dropped by the browser over plain HTTP, which
 * breaks LAN deployments (venue laptops talking to a local server). Decide from
 * the actual request protocol instead of NODE_ENV.
 */
export async function secureCookieFlag(): Promise<boolean> {
  try {
    const headersList = await headers();
    const proto = headersList.get("x-forwarded-proto");
    if (proto) return proto.split(",")[0].trim() === "https";
    return false;
  } catch {
    return false;
  }
}
