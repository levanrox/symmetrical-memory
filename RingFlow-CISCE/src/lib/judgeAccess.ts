/**
 * Judge access plumbing (PHASE P7a).
 *
 * Judges are volunteers on their own phones reaching RingFlow either via
 * venue WiFi (server fully offline) or via a public cloudflared tunnel
 * (scripts/start-judge-tunnel.sh). They may ONLY reach `/j/*` (judge
 * scoring pages) and a few public endpoints — admin/moderator/organiser/
 * stager pages are gated to private LAN IPs in src/proxy.ts.
 *
 * This module is deliberately free of static DB imports: the settings
 * helpers import `@/db` lazily so the module stays importable from the
 * Next.js proxy (edge/Node) and from unit tests without opening a DB
 * connection.
 */

/** app_settings key holding the admin-configured judge base URL. */
export const JUDGE_SETTING_KEY = "judge_base_url";

/** app_settings key holding the last "Test judge URL" result (JSON). */
export const JUDGE_LAST_TEST_SETTING_KEY = "judge_url_last_test";

// ---------------------------------------------------------------------------
// Pure helpers (no Next runtime, no DB — unit-testable)
// ---------------------------------------------------------------------------

/** Paths that must never be reachable from a non-private (public) client IP. */
export const RESTRICTED_PREFIXES = ["/admin", "/moderator", "/organiser", "/stager"] as const;

/**
 * Extract the client IP from request headers. Trusts `x-forwarded-for`
 * (first entry) falling back to `x-real-ip`.
 *
 * NOTE: these headers are only trustworthy because RingFlow is normally
 * reached directly (venue LAN or cloudflared, which sets them honestly).
 * If anything else ever proxies in front of the app they can be spoofed —
 * which is why this check is defense-in-depth behind the app's own session
 * auth, not a sole control. See src/proxy.ts.
 */
export function getClientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "";
}

/** True when `pathname` is one of the restricted staff areas. */
export function isRestrictedPath(pathname: string): boolean {
  return RESTRICTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/**
 * True when `ip` is a private/loopback/link-local address:
 * 10/8, 172.16/12, 192.168/16, 127/8, ::1, fc00::/7, fe80::/10.
 * Also recognises IPv4-mapped IPv6 (`::ffff:10.0.0.1`).
 */
export function isPrivateIp(ip: string): boolean {
  const raw = ip.trim().toLowerCase();
  if (!raw) return false;

  // Strip a trailing port if present ("1.2.3.4:3000", "[::1]:3000").
  let host = raw;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end === -1 ? host : host.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(host)) {
    host = host.slice(0, host.lastIndexOf(":"));
  }

  // IPv4-mapped IPv6: ::ffff:10.0.0.1
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  if (host.includes(".")) return isPrivateIpv4(host);
  if (host.includes(":")) return isPrivateIpv6(host);
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 loopback
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  // Expand :: shorthand to 8 hextets.
  const halves = ip.split("::");
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (left.length + right.length > 8) return false;
  const zeros = new Array(8 - left.length - right.length).fill("0");
  const full = [...left, ...zeros, ...right];
  if (full.length !== 8 || full.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return false;

  const first = parseInt(full[0], 16);
  if (ip === "::1" || (full.slice(0, 7).every((h) => h === "0") && full[7] === "1")) {
    return true; // ::1/128 loopback
  }
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

// ---------------------------------------------------------------------------
// Judge base URL resolution
// ---------------------------------------------------------------------------

/**
 * Normalise a base URL for judge join links: trim whitespace, drop trailing
 * slashes. Returns "" when nothing usable is configured.
 */
export function normaliseBaseUrl(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return "";
  // Only allow absolute http(s) URLs as a configured base; anything else is
  // treated as unconfigured so join links degrade to relative /j/<code>.
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, ""));
  } catch {
    return "";
  }
}

/**
 * Sync resolution used by the URL builder: JUDGE_BASE_URL env var only.
 * (Reading the DB-backed setting is async — use getJudgeBaseUrl() for that.)
 */
export function resolveEnvBaseUrl(): string {
  return normaliseBaseUrl(process.env.JUDGE_BASE_URL);
}

/**
 * Full resolution order: JUDGE_BASE_URL env var → app_settings DB value →
 * "" (empty means "venue WiFi / same-origin"; callers then emit relative
 * /j/<code> links).
 *
 * Env var wins so ops can override a stale DB value without touching the UI.
 */
export async function getJudgeBaseUrl(): Promise<string> {
  const fromEnv = resolveEnvBaseUrl();
  if (fromEnv) return fromEnv;
  const fromDb = await getAppSetting(JUDGE_SETTING_KEY);
  return normaliseBaseUrl(fromDb);
}

/**
 * Build the URL to encode in the judge QR code.
 *
 *   buildJudgeJoinUrl("AB12CD", "https://abc.trycloudflare.com") → "https://abc.trycloudflare.com/j/AB12CD"
 *   buildJudgeJoinUrl("AB12CD")                                   → "/j/AB12CD" (no base configured)
 *
 * Pass the awaited getJudgeBaseUrl() as `baseUrl` when the DB-backed value
 * is wanted: `buildJudgeJoinUrl(code, await getJudgeBaseUrl())`.
 */
export function buildJudgeJoinUrl(joinCode: string, baseUrl?: string): string {
  const code = encodeURIComponent(joinCode.trim());
  const base = normaliseBaseUrl(baseUrl ?? resolveEnvBaseUrl());
  return base ? `${base}/j/${code}` : `/j/${code}`;
}

// ---------------------------------------------------------------------------
// Judge URL test (PHASE P7b): probe + compare, kept pure for unit tests.
// The server action in src/actions/judgeAccess.ts composes these.
// ---------------------------------------------------------------------------

/** Raw outcome of probing `<baseUrl>/api/health`. */
export interface JudgeHealthProbeResult {
  /** A server answered (even with a non-2xx) and returned parseable JSON. */
  reachable: boolean;
  /** The `instanceId` the remote `/api/health` reported, if any. */
  remoteInstanceId: string | null;
  /** Round-trip time in ms. */
  latencyMs: number;
  /** Human-readable reason when something went wrong. */
  error?: string;
}

/** Full test result: the probe plus the this-server comparison. */
export interface JudgeUrlTestResult extends JudgeHealthProbeResult {
  /** True only when the probed URL demonstrably reaches THIS server. */
  ok: boolean;
  /** True when remote `instanceId` equals this server's. */
  instanceMatch: boolean;
  /** This server's per-boot instance ID (never hardcoded). */
  localInstanceId: string;
}

/** Where the effective judge base URL came from. */
export type JudgeUrlSource = "env" | "db" | "unset";

/** Last-test record persisted in app_settings (JSON). */
export interface JudgeUrlLastTest {
  at: string;
  url: string;
  ok: boolean;
  reachable: boolean;
  instanceMatch: boolean;
  latencyMs: number;
  localInstanceId: string;
  remoteInstanceId: string | null;
  error?: string;
}

/**
 * Fetch `<baseUrl>/api/health` and extract its `instanceId`.
 *
 * `fetchImpl` is injectable so unit tests can mock the network; defaults
 * to the global fetch. Never logs the URL or instance IDs.
 */
export async function probeJudgeHealth(
  baseUrl: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  timeoutMs = 8000,
): Promise<JudgeHealthProbeResult> {
  const started = Date.now();
  try {
    const res = await fetchImpl(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    let remoteInstanceId: string | null = null;
    try {
      const body = (await res.json()) as { instanceId?: unknown };
      remoteInstanceId =
        typeof body?.instanceId === "string" && body.instanceId ? body.instanceId : null;
    } catch {
      remoteInstanceId = null;
    }
    if (!remoteInstanceId) {
      return {
        reachable: true,
        remoteInstanceId: null,
        latencyMs,
        error: "Server answered but /api/health returned no instanceId.",
      };
    }
    return { reachable: true, remoteInstanceId, latencyMs };
  } catch (err) {
    return {
      reachable: false,
      remoteInstanceId: null,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "Request failed",
    };
  }
}

/**
 * Compare the probe result with this server's instance ID.
 *
 * `ok` is true ONLY when the remote ID equals the local one — a matching
 * ID proves the pasted URL reaches THIS server process, not a stale
 * tunnel, a typo'd host, or some other RingFlow instance.
 */
export function evaluateJudgeUrlTest(
  probe: JudgeHealthProbeResult,
  localInstanceId: string,
): JudgeUrlTestResult {
  const remote = probe.remoteInstanceId;
  const instanceMatch = probe.reachable && !!remote && remote === localInstanceId;
  return {
    ...probe,
    ok: instanceMatch,
    instanceMatch,
    localInstanceId,
  };
}

// ---------------------------------------------------------------------------
// app_settings key/value helpers (lazy DB import — safe from proxy/tests)
// ---------------------------------------------------------------------------

async function getDb() {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  return { db, schema };
}

export async function getAppSetting(key: string): Promise<string | null> {
  const { db, schema } = await getDb();
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const { db, schema } = await getDb();
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
