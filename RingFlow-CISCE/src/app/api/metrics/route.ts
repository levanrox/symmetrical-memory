import { registry } from "@/lib/metrics";

/**
 * Prometheus scrape endpoint. No auth: this server runs on a private LAN and
 * the metrics carry no user data (process stats + broadcast counters).
 */
export async function GET() {
  const body = await registry.metrics();
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": registry.contentType },
  });
}
