/**
 * Judge access plumbing (PHASE P7a, hardened in P9).
 *
 * TRUST MODEL (P9 H-1/H-3/M-1): the app is served through server.mjs, which
 * stamps every request with the socket's true peer address in `x-rf-peer`
 * (overwriting any client-sent value). That header is the ONLY client-IP
 * source the LAN gate and the rate limiter trust. `X-Forwarded-For`,
 * `X-Real-IP` and friends are client-controlled and are IGNORED entirely —
 * never the first entry, never the last entry — which kills both the
 * XFF-spoofing LAN-gate bypass and XFF-rotation rate-limit evasion.
 *
 * If the app is ever run without server.mjs (plain `next start`), `x-rf-peer`
 * is absent: the LAN gate fails CLOSED (staff pages 404 + a warning) and the
 * rate limiter fails OPEN on a generous shared budget. See src/proxy.ts and
 * src/lib/rateLimit.ts.
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

/**
 * The trusted peer-IP header. Stamped by server.mjs from the TCP socket's
 * remoteAddress on EVERY request (client-sent values are overwritten, so it
 * cannot be spoofed). Must match PEER_IP_HEADER in server.mjs.
 */
export const PEER_IP_HEADER = "x-rf-peer";

// ---------------------------------------------------------------------------
// Pure helpers (no Next runtime, no DB — unit-testable)
// ---------------------------------------------------------------------------

/** Paths that must never be reachable from a non-private (public) client IP. */
export const RESTRICTED_PREFIXES = ["/admin", "/moderator", "/organiser", "/stager"] as const;

/**
 * The direct peer IP of this request, from the server-stamped `x-rf-peer`
 * header (see server.mjs). Returns "" when the header is absent — i.e. the
 * peer IP is NOT verifiable (app not running under server.mjs) — so callers
 * can fail closed. `X-Forwarded-For` / `X-Real-IP` are deliberately never
 * consulted: they are client-controlled (P9 M-1/L-5).
 */
export function getPeerIp(headers: Pick<Headers, "get">): string {
  return (headers.get(PEER_IP_HEADER) ?? "").trim();
}

/**
 * True when the request arrived through the public cloudflared tunnel.
 *
 * cloudflared always adds `CF-Ray` / `CF-Connecting-IP` and clients cannot
 * suppress them on the tunnel path. The tunnel terminates at localhost:3000
 * (scripts/start-judge-tunnel.sh), so tunnel traffic has a *private* peer IP
 * (127.0.0.1) — the LAN gate must still refuse it staff pages. Note a direct
 * client CAN forge these headers, but that only fails closed (denies staff),
 * never bypasses the gate.
 */
export function isTunnelRequest(headers: Pick<Headers, "get">): boolean {
  return !!(headers.get("cf-ray")?.trim() || headers.get("cf-connecting-ip")?.trim());
}

/** True when `pathname` is one of the restricted staff areas. */
export function isRestrictedPath(pathname: string): boolean {
  return RESTRICTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/** How a rate-limit bucket key was derived. */
export type RateLimitIdentity =
  | { ip: string; via: "direct-peer" }
  | { ip: string; via: "tunnel-client" }
  | { ip: null; via: "unknown" };

/**
 * Resolve the IP a rate-limit bucket should be keyed on (P9 H-3).
 *
 * - Direct request: the trusted peer IP (`x-rf-peer`, stamped by server.mjs).
 * - Tunnel request (cloudflared markers present AND the direct peer is
 *   loopback, i.e. the tunnel terminates on this host per
 *   scripts/start-judge-tunnel.sh): the judge's real client IP from
 *   `CF-Connecting-IP`, which cloudflared sets and which cannot be spoofed
 *   *through the tunnel*. Requiring a loopback peer stops a direct-LAN
 *   client from forging `CF-Ray` + rotating `CF-Connecting-IP` to mint fresh
 *   buckets (P9 M-1).
 * - No verifiable peer IP (`x-rf-peer` absent): `{ ip: null }` — the caller
 *   must fail OPEN on a generous shared budget (see src/lib/rateLimit.ts),
 *   never lump everyone into a tight per-IP bucket.
 *
 * `X-Forwarded-For` is never consulted: through cloudflared the client
 * controls its leading entries, so neither first nor last entry is
 * trustworthy (P9 M-1/L-5).
 */
export function resolveRateLimitIdentity(
  headers: Pick<Headers, "get">,
): RateLimitIdentity {
  const peer = getPeerIp(headers);
  if (!peer) return { ip: null, via: "unknown" };
  if (isLoopbackIp(peer) && isTunnelRequest(headers)) {
    const cfIp = (headers.get("cf-connecting-ip") ?? "").trim();
    if (cfIp && cfIp.length <= 64 && isValidIpLiteral(cfIp)) {
      return { ip: cfIp, via: "tunnel-client" };
    }
    // Tunnel markers but no usable CF-Connecting-IP: fall through to the
    // loopback peer — coarse but safe (shared bucket for tunnel traffic).
  }
  return { ip: peer, via: "direct-peer" };
}

/**
 * Strip brackets/ports/whitespace and lowercase an IP-ish string, so the
 * classifiers below see the bare host. ("1.2.3.4:3000", "[::1]:3000").
 */
function normalizeIpHost(ip: string): string {
  let host = ip.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end === -1 ? host : host.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(host)) {
    host = host.slice(0, host.lastIndexOf(":"));
  }
  return host;
}

/**
 * Drop an IPv4-mapped IPv6 wrapper: `::ffff:10.0.0.1` → `10.0.0.1`, and the
 * hex form `::ffff:a9fe:a9fe` → `169.254.169.254` (URL parsers normalise the
 * dotted form to hex, e.g. `new URL("http://[::ffff:169.254.169.254]/")`).
 */
function unmapIpv4(host: string): string {
  const dotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1] as string;
  const hex = host.match(/^::ffff:([0-9a-fA-F]{1,4}):([0-9a-fA-F]{1,4})$/);
  if (hex) {
    const n = parseInt(`${hex[1]}${hex[2]}`, 16);
    if (!Number.isNaN(n) && n >= 0 && n <= 0xffffffff) {
      return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
    }
  }
  return host;
}

/**
 * True when `ip` is a private/loopback/link-local address:
 * 10/8, 172.16/12, 192.168/16, 127/8, ::1, fc00::/7, fe80::/10.
 * Also recognises IPv4-mapped IPv6 (`::ffff:10.0.0.1`).
 */
export function isPrivateIp(ip: string): boolean {
  const host = unmapIpv4(normalizeIpHost(ip));
  if (!host) return false;

  if (host.includes(".")) return isPrivateIpv4(host);
  if (host.includes(":")) return isPrivateIpv6(host);
  return false;
}

/** True for 127.0.0.0/8 and ::1 (incl. IPv4-mapped forms). */
export function isLoopbackIp(ip: string): boolean {
  const host = unmapIpv4(normalizeIpHost(ip));
  if (!host) return false;
  if (host === "::1") return true;
  if (host.includes(".")) {
    const parts = host.split(".").map(Number);
    return (
      parts.length === 4 &&
      parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      parts[0] === 127
    );
  }
  return false;
}

/** True when `s` parses as an IPv4 or IPv6 literal (any range, not just private). */
export function isValidIpLiteral(s: string): boolean {
  const host = unmapIpv4(normalizeIpHost(s));
  if (!host) return false;
  if (host.includes(".") && !host.includes(":")) {
    const parts = host.split(".").map(Number);
    return (
      parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    );
  }
  if (host.includes(":")) {
    // Reuse the strict v6 expansion check: private-v6 returns false for
    // public ranges, so validate the shape directly here.
    const halves = host.split("::");
    if (halves.length > 2) return false;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    if (left.length + right.length > 8) return false;
    const zeros = new Array(8 - left.length - right.length).fill("0");
    const full = [...left, ...zeros, ...right];
    return full.length === 8 && full.every((h) => /^[0-9a-f]{1,4}$/.test(h));
  }
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
 * SSRF guard for the admin "Test judge URL" probe (P9 L-4).
 *
 * The probe fetches an admin-pasted URL server-side. Admins are trusted, but
 * a pasted cloud-metadata URL would still leak instance credentials, so
 * link-local / metadata targets are refused outright. Returns a human-
 * readable reason when blocked, null when the target is allowed.
 *
 * Blocked: 169.254.169.254, all of 169.254.0.0/16 (link-local, incl. the
 * IPv4-mapped ::ffff: form), and metadata.google.internal-style hostnames.
 */
export function isProbeTargetBlocked(baseUrl: string): string | null {
  let host: string;
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return `Refusing to probe non-http(s) URL.`;
    }
    host = u.hostname.toLowerCase();
  } catch {
    return "Refusing to probe an unparseable URL.";
  }
  if (!host) return "Refusing to probe an empty host.";

  const METADATA_HOSTNAMES = new Set([
    "metadata.google.internal",
    "metadata.google.internal.",
  ]);
  if (
    METADATA_HOSTNAMES.has(host) ||
    host.endsWith(".metadata.google.internal") ||
    host.endsWith(".metadata.google.internal.")
  ) {
    return "Refusing to probe a cloud metadata hostname.";
  }

  // 169.254.0.0/16 in dotted, mapped, or bracketed form.
  const dotted = unmapIpv4(host.replace(/^\[|\]$/g, ""));
  const parts = dotted.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    parts[0] === 169 &&
    parts[1] === 254
  ) {
    return "Refusing to probe a link-local address (169.254.0.0/16).";
  }
  return null;
}
/**
 * Fetch `<baseUrl>/api/health` and extract its `instanceId`.
 *
 * `fetchImpl` is injectable so unit tests can mock the network; defaults
 * to the global fetch. Never logs the URL or instance IDs.
 *
 * SSRF guard (P9 L-4): link-local / cloud-metadata targets are refused
 * before any fetch happens.
 */
export async function probeJudgeHealth(
  baseUrl: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  timeoutMs = 8000,
): Promise<JudgeHealthProbeResult> {
  const blocked = isProbeTargetBlocked(baseUrl);
  if (blocked) {
    return {
      reachable: false,
      remoteInstanceId: null,
      latencyMs: 0,
      error: blocked,
    };
  }
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
