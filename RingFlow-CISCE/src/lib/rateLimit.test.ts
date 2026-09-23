/**
 * Unit tests for the rate limiter (P9 H-3 / M-1).
 *
 * Buckets must be keyed on the trusted peer IP (`x-rf-peer`, stamped by
 * server.mjs) — never on X-Forwarded-For — and when no peer IP is verifiable
 * the limiter must fail OPEN on a generous shared budget rather than lumping
 * everyone into one tight per-IP bucket.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { headers } from "next/headers";
import {
  UNKNOWN_IP_LIMIT_MULTIPLIER,
  checkIpRateLimit,
  checkRateLimit,
  rateLimitIp,
} from "./rateLimit";
import { PEER_IP_HEADER } from "./judgeAccess";

function mockHeaders(init: Record<string, string>) {
  vi.mocked(headers).mockResolvedValue(new Headers(init) as unknown as Awaited<
    ReturnType<typeof headers>
  >);
}

beforeEach(() => {
  vi.mocked(headers).mockReset();
});

describe("checkRateLimit (key buckets)", () => {
  it("throws once the limit is exceeded and isolates keys", () => {
    const key = `t-basic-${Date.now()}-${Math.random()}`;
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000);
    expect(() => checkRateLimit(key, 2, 60_000)).toThrow(/Too many attempts/);
    // A different key is unaffected.
    expect(() => checkRateLimit(`${key}-other`, 2, 60_000)).not.toThrow();
  });
});

describe("checkIpRateLimit (P9 H-3)", () => {
  it("keys buckets on the trusted peer IP, per IP", async () => {
    const action = `t-perip-${Date.now()}-${Math.random()}`;
    mockHeaders({ [PEER_IP_HEADER]: "192.168.1.50" });
    await checkIpRateLimit(action, 1, 60_000);
    await expect(checkIpRateLimit(action, 1, 60_000)).rejects.toThrow(
      /Too many attempts/
    );

    // A different peer IP gets its own bucket.
    mockHeaders({ [PEER_IP_HEADER]: "192.168.1.51" });
    await expect(checkIpRateLimit(action, 1, 60_000)).resolves.toBeUndefined();
  });

  it("ignores X-Forwarded-For rotation (P9 M-1)", async () => {
    const action = `t-xff-${Date.now()}-${Math.random()}`;
    mockHeaders({
      [PEER_IP_HEADER]: "192.168.1.60",
      "x-forwarded-for": "203.0.113.1",
    });
    await checkIpRateLimit(action, 1, 60_000);
    // Rotating the header must NOT mint a fresh bucket.
    mockHeaders({
      [PEER_IP_HEADER]: "192.168.1.60",
      "x-forwarded-for": "203.0.113.2",
    });
    await expect(checkIpRateLimit(action, 1, 60_000)).rejects.toThrow(
      /Too many attempts/
    );
  });

  it("keys tunnel judges on CF-Connecting-IP, not the loopback peer", async () => {
    const action = `t-tunnel-${Date.now()}-${Math.random()}`;
    const tunnel = {
      [PEER_IP_HEADER]: "127.0.0.1",
      "cf-ray": "abc-DEL",
      "cf-connecting-ip": "203.0.113.9",
    };
    mockHeaders(tunnel);
    await checkIpRateLimit(action, 1, 60_000);
    await expect(checkIpRateLimit(action, 1, 60_000)).rejects.toThrow(
      /Too many attempts/
    );

    // A second judge behind the same tunnel peer gets their own bucket.
    mockHeaders({
      ...tunnel,
      "cf-connecting-ip": "203.0.113.10",
    });
    await expect(checkIpRateLimit(action, 1, 60_000)).resolves.toBeUndefined();
  });

  it("fails OPEN on a generous shared budget when no peer IP is verifiable", async () => {
    const action = `t-unknown-${Date.now()}-${Math.random()}`;
    mockHeaders({}); // no x-rf-peer: peer IP not verifiable
    // The tight per-IP limit (2) must NOT apply to the shared bucket...
    await checkIpRateLimit(action, 2, 60_000);
    await checkIpRateLimit(action, 2, 60_000);
    await checkIpRateLimit(action, 2, 60_000);
    // ...but the generous shared budget (2 * multiplier) still caps floods.
    const sharedLimit = 2 * UNKNOWN_IP_LIMIT_MULTIPLIER;
    for (let i = 3; i < sharedLimit; i += 1) {
      await checkIpRateLimit(action, 2, 60_000);
    }
    await expect(checkIpRateLimit(action, 2, 60_000)).rejects.toThrow(
      /Too many attempts/
    );
  });
});

describe("rateLimitIp", () => {
  it("returns the trusted peer IP", async () => {
    mockHeaders({ [PEER_IP_HEADER]: "10.0.0.9" });
    expect(await rateLimitIp()).toBe("10.0.0.9");
  });

  it("returns null when headers() throws", async () => {
    vi.mocked(headers).mockRejectedValue(new Error("no store"));
    expect(await rateLimitIp()).toBeNull();
  });
});
