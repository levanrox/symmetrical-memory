/**
 * Unit tests for signed session cookies (src/lib/auth/sessionCookies.ts).
 *
 * These cover the Phase-0 security fix: cookie values must be HMAC-signed
 * with SESSION_SECRET, and forged/legacy values must be rejected.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { signCookieValue, verifyCookieValue } from "./sessionCookies";

const ORIGINAL_SECRET = process.env.SESSION_SECRET;
const ORIGINAL_BASE = process.env.SECRET_KEY_BASE;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-for-unit-tests-only";
  delete process.env.SECRET_KEY_BASE;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_BASE === undefined) delete process.env.SECRET_KEY_BASE;
  else process.env.SECRET_KEY_BASE = ORIGINAL_BASE;
});

describe("signCookieValue", () => {
  it("signs a value into '<value>.<hex-signature>' format", () => {
    const signed = signCookieValue("admin-user-id-123");
    expect(signed).toMatch(/^admin-user-id-123\.[0-9a-f]{64}$/);
  });

  it("is deterministic for the same value and secret", () => {
    expect(signCookieValue("abc")).toBe(signCookieValue("abc"));
  });

  it("throws on empty values and values containing dots", () => {
    expect(() => signCookieValue("")).toThrow();
    expect(() => signCookieValue("a.b")).toThrow();
  });
});

describe("verifyCookieValue", () => {
  it("round-trips a signed value", () => {
    const value = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    expect(verifyCookieValue(signCookieValue(value))).toBe(value);
  });

  it("rejects a tampered signature", () => {
    const signed = signCookieValue("some-value");
    const tampered = signed.slice(0, -1) + (signed.endsWith("0") ? "1" : "0");
    expect(verifyCookieValue(tampered)).toBeNull();
  });

  it("rejects a tampered value with the original signature", () => {
    const signed = signCookieValue("real-value");
    const sig = signed.slice(signed.lastIndexOf(".") + 1);
    expect(verifyCookieValue(`fake-value.${sig}`)).toBeNull();
  });

  it("rejects a value signed with a different secret", () => {
    const signed = signCookieValue("some-value");
    process.env.SESSION_SECRET = "a-different-secret";
    expect(verifyCookieValue(signed)).toBeNull();
  });

  it("rejects legacy unsigned values (no dot)", () => {
    expect(verifyCookieValue("plain-uuid-value")).toBeNull();
    expect(verifyCookieValue("")).toBeNull();
    expect(verifyCookieValue(undefined)).toBeNull();
    expect(verifyCookieValue(null)).toBeNull();
  });

  it("rejects malformed values (leading/trailing dots)", () => {
    expect(verifyCookieValue(".abc")).toBeNull();
    expect(verifyCookieValue("abc.")).toBeNull();
  });

  it("falls back to SECRET_KEY_BASE when SESSION_SECRET is unset", () => {
    delete process.env.SESSION_SECRET;
    process.env.SECRET_KEY_BASE = "fallback-base";
    const value = "some-value";
    expect(verifyCookieValue(signCookieValue(value))).toBe(value);
  });

  it("throws a clear error when no secret is configured", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.SECRET_KEY_BASE;
    expect(() => signCookieValue("x")).toThrow(/SESSION_SECRET/);
  });
});
