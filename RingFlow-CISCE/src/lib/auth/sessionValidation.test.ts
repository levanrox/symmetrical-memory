/**
 * Unit tests for assertValidSession (src/lib/auth/sessionValidation.ts) —
 * the H2 token-only contract.
 *
 * The request id is broadcast over the realtime socket and visible to any
 * passive LAN sniffer, so it must NEVER validate as a credential. Only the
 * per-request sessionToken (stored in an httpOnly cookie) authenticates.
 */
import { describe, expect, it } from "vitest";
import { assertValidSession } from "./sessionValidation";

const baseRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  sessionToken: "22222222-2222-4222-8222-222222222222",
  status: "approved",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h in the future
};

describe("assertValidSession", () => {
  it("validates when the token matches sessionToken", () => {
    const result = assertValidSession(baseRequest, baseRequest.sessionToken);
    expect(result).toBe(baseRequest);
  });

  it("REJECTS the request id used as the token (H2)", () => {
    // The id is public (broadcast payloads); accepting it would let any
    // LAN sniffer hijack the session.
    expect(assertValidSession(baseRequest, baseRequest.id)).toBeNull();
  });

  it("rejects a wrong token", () => {
    expect(
      assertValidSession(baseRequest, "33333333-3333-4333-8333-333333333333")
    ).toBeNull();
  });

  it("rejects expired sessions", () => {
    const expired = {
      ...baseRequest,
      expiresAt: new Date(Date.now() - 1000),
    };
    expect(assertValidSession(expired, expired.sessionToken)).toBeNull();
  });

  it("rejects null/undefined inputs", () => {
    expect(assertValidSession(null, "token")).toBeNull();
    expect(assertValidSession(undefined, "token")).toBeNull();
    expect(assertValidSession(baseRequest, null)).toBeNull();
    expect(assertValidSession(baseRequest, undefined)).toBeNull();
    expect(assertValidSession(baseRequest, "")).toBeNull();
  });

  it("rejects when the stored sessionToken is null", () => {
    const noToken = { ...baseRequest, sessionToken: null };
    expect(assertValidSession(noToken, "any-token")).toBeNull();
  });

  it("accepts a null expiresAt (non-expiring session)", () => {
    const noExpiry = { ...baseRequest, expiresAt: null };
    expect(assertValidSession(noExpiry, noExpiry.sessionToken)).toBe(
      noExpiry
    );
  });
});
