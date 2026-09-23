/**
 * Unit tests for the judge-access plumbing (src/lib/judgeAccess.ts).
 *
 * These cover the pure functions used by src/proxy.ts (IP gating) and the
 * QR-link URL builder. DB-backed getJudgeBaseUrl()/getAppSetting() are not
 * exercised here (they need a live database); env-var resolution is covered
 * via JUDGE_BASE_URL.
 */

import { describe, expect, it, afterEach, vi } from "vitest";
import {
  PEER_IP_HEADER,
  getPeerIp,
  isLoopbackIp,
  isPrivateIp,
  isProbeTargetBlocked,
  isRestrictedPath,
  isTunnelRequest,
  isValidIpLiteral,
  normaliseBaseUrl,
  resolveEnvBaseUrl,
  resolveRateLimitIdentity,
  buildJudgeJoinUrl,
  probeJudgeHealth,
  evaluateJudgeUrlTest,
} from "./judgeAccess";

describe("isPrivateIp", () => {
  const privateIps = [
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
    "192.168.255.255",
    "127.0.0.1",
    "127.1.2.3",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::aabb:ccff:fedd:eeff",
    "::ffff:10.0.0.5",
    "::ffff:192.168.1.10",
    "::ffff:127.0.0.1",
    "  192.168.1.2  ",
    "192.168.1.2:3000",
    "[::1]:3000",
  ];
  it.each(privateIps)("treats %s as private", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  const publicIps = [
    "8.8.8.8",
    "1.1.1.1",
    "203.0.113.10",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.1.1",
    "11.0.0.1",
    "2001:db8::1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "",
    "not-an-ip",
    "999.999.999.999",
  ];
  it.each(publicIps)("treats %s as public", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("getPeerIp (P9 H-1)", () => {
  const headersOf = (init: Record<string, string>) => new Headers(init);

  it("reads ONLY the server-stamped peer header", () => {
    expect(getPeerIp(headersOf({ [PEER_IP_HEADER]: "192.168.1.50" }))).toBe(
      "192.168.1.50"
    );
  });

  it("ignores x-forwarded-for and x-real-ip entirely (P9 M-1/L-5)", () => {
    // Even a spoofed private XFF must not become the peer IP.
    expect(
      getPeerIp(
        headersOf({
          "x-forwarded-for": "10.0.0.1, 203.0.113.9",
          "x-real-ip": "10.0.0.2",
        })
      )
    ).toBe("");
    // And a stamped peer header wins over (ignores) XFF.
    expect(
      getPeerIp(
        headersOf({
          [PEER_IP_HEADER]: "192.168.1.50",
          "x-forwarded-for": "10.0.0.1",
        })
      )
    ).toBe("192.168.1.50");
  });

  it("returns empty string when the header is absent (fail-closed signal)", () => {
    expect(getPeerIp(headersOf({}))).toBe("");
  });

  it("trims whitespace", () => {
    expect(getPeerIp(headersOf({ [PEER_IP_HEADER]: "  10.1.2.3  " }))).toBe(
      "10.1.2.3"
    );
  });
});

describe("isTunnelRequest", () => {
  const headersOf = (init: Record<string, string>) => new Headers(init);

  it("detects cloudflared markers", () => {
    expect(isTunnelRequest(headersOf({ "cf-ray": "abc123-DEL" }))).toBe(true);
    expect(
      isTunnelRequest(headersOf({ "cf-connecting-ip": "203.0.113.9" }))
    ).toBe(true);
  });

  it("is false for direct requests", () => {
    expect(
      isTunnelRequest(headersOf({ [PEER_IP_HEADER]: "192.168.1.50" }))
    ).toBe(false);
    expect(isTunnelRequest(headersOf({}))).toBe(false);
  });
});

describe("isLoopbackIp", () => {
  it("recognises loopback forms", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopbackIp(ip)).toBe(true);
    }
  });

  it("rejects non-loopback addresses", () => {
    for (const ip of ["192.168.1.1", "10.0.0.1", "8.8.8.8", "", "not-an-ip"]) {
      expect(isLoopbackIp(ip)).toBe(false);
    }
  });
});

describe("isValidIpLiteral", () => {
  it("accepts v4 and v6 literals of any range", () => {
    for (const ip of [
      "192.168.1.1",
      "8.8.8.8",
      "203.0.113.9",
      "::1",
      "2001:db8::1",
      "::ffff:203.0.113.9",
    ]) {
      expect(isValidIpLiteral(ip)).toBe(true);
    }
  });

  it("rejects garbage", () => {
    for (const s of ["", "not-an-ip", "999.1.1.1", "1.2.3", "1.2.3.4.5", "evil.com"]) {
      expect(isValidIpLiteral(s)).toBe(false);
    }
  });
});

describe("resolveRateLimitIdentity (P9 H-3)", () => {
  const headersOf = (init: Record<string, string>) => new Headers(init);

  it("keys direct requests on the trusted peer IP", () => {
    expect(
      resolveRateLimitIdentity(headersOf({ [PEER_IP_HEADER]: "192.168.1.50" }))
    ).toEqual({ ip: "192.168.1.50", via: "direct-peer" });
  });

  it("keys tunnel requests on CF-Connecting-IP when the peer is loopback", () => {
    expect(
      resolveRateLimitIdentity(
        headersOf({
          [PEER_IP_HEADER]: "127.0.0.1",
          "cf-ray": "abc-DEL",
          "cf-connecting-ip": "203.0.113.9",
        })
      )
    ).toEqual({ ip: "203.0.113.9", via: "tunnel-client" });
  });

  it("ignores a forged cf-connecting-ip from a non-loopback peer (P9 M-1)", () => {
    // A venue-LAN client forging CF-Ray cannot mint fresh buckets.
    expect(
      resolveRateLimitIdentity(
        headersOf({
          [PEER_IP_HEADER]: "192.168.1.50",
          "cf-ray": "forged",
          "cf-connecting-ip": "203.0.113.99",
        })
      )
    ).toEqual({ ip: "192.168.1.50", via: "direct-peer" });
  });

  it("falls back to the loopback peer when tunnel markers lack a usable IP", () => {
    expect(
      resolveRateLimitIdentity(
        headersOf({ [PEER_IP_HEADER]: "127.0.0.1", "cf-ray": "abc-DEL" })
      )
    ).toEqual({ ip: "127.0.0.1", via: "direct-peer" });
  });

  it("returns unknown when no peer IP is verifiable (fail-open signal)", () => {
    expect(resolveRateLimitIdentity(headersOf({}))).toEqual({
      ip: null,
      via: "unknown",
    });
  });
});

describe("isProbeTargetBlocked (P9 L-4)", () => {
  it("blocks link-local and metadata targets", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.169.254:80/api/health",
      "http://169.254.10.20/api/health",
      "http://[::ffff:169.254.169.254]/api/health",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://foo.metadata.google.internal/",
    ]) {
      expect(isProbeTargetBlocked(url)).not.toBeNull();
    }
  });

  it("allows ordinary tunnel / LAN URLs", () => {
    for (const url of [
      "https://abc123.trycloudflare.com",
      "http://192.168.1.9:3000",
      "http://localhost:3000/",
    ]) {
      expect(isProbeTargetBlocked(url)).toBeNull();
    }
  });

  it("refuses non-http(s) and unparseable URLs", () => {
    expect(isProbeTargetBlocked("ftp://example.com/x")).not.toBeNull();
    expect(isProbeTargetBlocked("not a url")).not.toBeNull();
  });
});

describe("isRestrictedPath", () => {
  it("matches staff areas and their subpaths", () => {
    for (const p of ["/admin", "/admin/login", "/moderator", "/moderator/x", "/organiser", "/stager/y"]) {
      expect(isRestrictedPath(p)).toBe(true);
    }
  });

  it("leaves judge, health, api and public paths alone", () => {
    for (const p of ["/", "/j", "/j/AB12CD", "/api/health", "/api/live", "/tournament", "/administrator", "/adminx"]) {
      expect(isRestrictedPath(p)).toBe(false);
    }
  });
});

describe("normaliseBaseUrl", () => {
  it("strips trailing slashes and keeps path", () => {
    expect(normaliseBaseUrl("https://abc.trycloudflare.com///")).toBe("https://abc.trycloudflare.com");
    expect(normaliseBaseUrl("https://abc.trycloudflare.com/t/")).toBe("https://abc.trycloudflare.com/t");
  });

  it("rejects empty, relative and non-http values", () => {
    expect(normaliseBaseUrl("")).toBe("");
    expect(normaliseBaseUrl(null)).toBe("");
    expect(normaliseBaseUrl("/j/AB12")).toBe("");
    expect(normaliseBaseUrl("ftp://x.example")).toBe("");
    expect(normaliseBaseUrl("not a url")).toBe("");
  });
});

describe("buildJudgeJoinUrl", () => {
  afterEach(() => {
    delete process.env.JUDGE_BASE_URL;
  });

  it("builds a full URL when a base is given", () => {
    expect(buildJudgeJoinUrl("AB12CD", "https://abc.trycloudflare.com")).toBe(
      "https://abc.trycloudflare.com/j/AB12CD",
    );
    expect(buildJudgeJoinUrl("AB12CD", "https://abc.trycloudflare.com/")).toBe(
      "https://abc.trycloudflare.com/j/AB12CD",
    );
  });

  it("falls back to a relative URL when no base is configured", () => {
    expect(buildJudgeJoinUrl("AB12CD")).toBe("/j/AB12CD");
    expect(buildJudgeJoinUrl("AB12CD", "")).toBe("/j/AB12CD");
  });

  it("URL-encodes the join code", () => {
    expect(buildJudgeJoinUrl("AB 12/CD", "https://abc.trycloudflare.com")).toBe(
      "https://abc.trycloudflare.com/j/AB%2012%2FCD",
    );
  });

  it("reads the base from JUDGE_BASE_URL when not passed explicitly", () => {
    process.env.JUDGE_BASE_URL = "https://tunnel.example.com";
    expect(resolveEnvBaseUrl()).toBe("https://tunnel.example.com");
    expect(buildJudgeJoinUrl("ZZ99")).toBe("https://tunnel.example.com/j/ZZ99");
  });
});

describe("normaliseBaseUrl edge cases (P7b)", () => {
  it("trims whitespace and drops a port-only path", () => {
    expect(normaliseBaseUrl("  https://abc.trycloudflare.com  ")).toBe(
      "https://abc.trycloudflare.com",
    );
  });

  it("keeps non-default ports", () => {
    expect(normaliseBaseUrl("http://192.168.1.10:3000/")).toBe("http://192.168.1.10:3000");
  });

  it("lowercases the scheme and keeps a sub-path", () => {
    expect(normaliseBaseUrl("HTTPS://example.com/sub//")).toBe("https://example.com/sub");
  });

  it("drops query strings and fragments", () => {
    expect(normaliseBaseUrl("https://example.com/path?x=1#frag")).toBe(
      "https://example.com/path",
    );
  });

  it("drops embedded credentials", () => {
    expect(normaliseBaseUrl("https://user:pass@example.com")).toBe("https://example.com");
  });

  it("rejects javascript: and bare hostnames", () => {
    expect(normaliseBaseUrl("javascript:alert(1)")).toBe("");
    expect(normaliseBaseUrl("example.com")).toBe("");
    expect(normaliseBaseUrl("//example.com")).toBe("");
    expect(normaliseBaseUrl("https://")).toBe("");
  });
});

describe("probeJudgeHealth (P7b, mocked fetch)", () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("extracts the instanceId from a healthy /api/health", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "ok", instanceId: "local-1" }));
    const probe = await probeJudgeHealth("https://t.example", fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://t.example/api/health");
    expect(probe.reachable).toBe(true);
    expect(probe.remoteInstanceId).toBe("local-1");
    expect(probe.error).toBeUndefined();
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("stays reachable when the server reports degraded (503 with JSON body)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "degraded", instanceId: "r-2" }, 503));
    const probe = await probeJudgeHealth("https://t.example", fetchImpl as typeof fetch);
    expect(probe.reachable).toBe(true);
    expect(probe.remoteInstanceId).toBe("r-2");
  });

  it("reports an error when the body has no instanceId", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "ok" }));
    const probe = await probeJudgeHealth("https://t.example", fetchImpl as typeof fetch);
    expect(probe.reachable).toBe(true);
    expect(probe.remoteInstanceId).toBeNull();
    expect(probe.error).toMatch(/instanceId/);
  });

  it("reports an error when the body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>nope</html>", { status: 404 }));
    const probe = await probeJudgeHealth("https://t.example", fetchImpl as typeof fetch);
    expect(probe.reachable).toBe(true);
    expect(probe.remoteInstanceId).toBeNull();
    expect(probe.error).toMatch(/instanceId/);
  });

  it("reports unreachable when fetch rejects (tunnel down / DNS)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const probe = await probeJudgeHealth("https://t.example", fetchImpl as typeof fetch);
    expect(probe.reachable).toBe(false);
    expect(probe.remoteInstanceId).toBeNull();
    expect(probe.error).toBe("fetch failed");
  });

  it("refuses link-local / metadata targets WITHOUT fetching (P9 L-4)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ instanceId: "x" }));
    const probe = await probeJudgeHealth(
      "http://169.254.169.254/latest/meta-data/",
      fetchImpl as typeof fetch
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(probe.reachable).toBe(false);
    expect(probe.error).toMatch(/link-local/);
  });
});

describe("evaluateJudgeUrlTest (P7b)", () => {
  const base = {
    reachable: true,
    remoteInstanceId: "abc-123",
    latencyMs: 42,
  };

  it("ok is true only when the remote ID equals the local ID", () => {
    const res = evaluateJudgeUrlTest(base, "abc-123");
    expect(res.ok).toBe(true);
    expect(res.instanceMatch).toBe(true);
    expect(res.localInstanceId).toBe("abc-123");
    expect(res.remoteInstanceId).toBe("abc-123");
    expect(res.latencyMs).toBe(42);
  });

  it("fails when the IDs differ (stale tunnel / wrong server)", () => {
    const res = evaluateJudgeUrlTest(base, "different-id");
    expect(res.ok).toBe(false);
    expect(res.instanceMatch).toBe(false);
  });

  it("fails when the server was unreachable", () => {
    const res = evaluateJudgeUrlTest(
      { reachable: false, remoteInstanceId: null, latencyMs: 5, error: "fetch failed" },
      "abc-123",
    );
    expect(res.ok).toBe(false);
    expect(res.instanceMatch).toBe(false);
    expect(res.error).toBe("fetch failed");
  });

  it("fails when there is no remote instanceId even though the host answered", () => {
    const res = evaluateJudgeUrlTest(
      { reachable: true, remoteInstanceId: null, latencyMs: 5, error: "no instanceId" },
      "abc-123",
    );
    expect(res.ok).toBe(false);
    expect(res.instanceMatch).toBe(false);
  });
});
