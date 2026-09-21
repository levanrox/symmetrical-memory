/**
 * Unit tests for live-event Ed25519 signing (src/lib/realtime/eventSigning.ts)
 * and the client-side verification in events.ts (M2 fix).
 *
 * The server signs every broadcast event; browsers verify the signature
 * against /api/live-pubkey before scope matching, so a LAN attacker cannot
 * forge score-change notifications.
 */
import { describe, expect, it, beforeAll } from "vitest";

// Fixed test secret: the signing key is derived deterministically from it.
beforeAll(() => {
  process.env.SESSION_SECRET = "test-only-secret-for-live-event-signing";
});

import { signLiveEvent, getLiveEventPublicKeyHex } from "./eventSigning";
import {
  canonicalizeLiveEvent,
  parseLiveEvent,
  verifyLiveEventSignature,
  type LiveEvent,
} from "./events";

const sampleEvent: LiveEvent = {
  table: "matches",
  op: "UPDATE",
  id: "match-1",
  ringId: "ring-1",
  akaScore: 3,
  aoScore: 1,
};

describe("signLiveEvent / verifyLiveEventSignature round-trip", () => {
  it("signs and verifies a valid event", () => {
    const pubkey = getLiveEventPublicKeyHex();
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
    const signed = signLiveEvent(sampleEvent);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyLiveEventSignature(signed, pubkey)).toBe(true);
  });

  it("derives a stable keypair across calls (restart-safe)", () => {
    expect(getLiveEventPublicKeyHex()).toBe(getLiveEventPublicKeyHex());
    const a = signLiveEvent(sampleEvent);
    const b = signLiveEvent(sampleEvent);
    // Ed25519 is deterministic: same payload + same key = same signature.
    expect(a.sig).toBe(b.sig);
  });

  it("does not mutate the input event", () => {
    const input = { ...sampleEvent };
    signLiveEvent(input);
    expect(input.sig).toBeUndefined();
  });

  it("rejects a tampered payload", () => {
    const pubkey = getLiveEventPublicKeyHex();
    const signed = signLiveEvent(sampleEvent);
    const tampered: LiveEvent = { ...signed, akaScore: 99 };
    expect(verifyLiveEventSignature(tampered, pubkey)).toBe(false);
  });

  it("rejects a forged signature from a different key", () => {
    const pubkey = getLiveEventPublicKeyHex();
    const signed = signLiveEvent(sampleEvent);
    const forged: LiveEvent = {
      ...signed,
      sig: "00".repeat(64),
    };
    expect(verifyLiveEventSignature(forged, pubkey)).toBe(false);
  });

  it("rejects unsigned events and empty keys", () => {
    const pubkey = getLiveEventPublicKeyHex();
    expect(verifyLiveEventSignature(sampleEvent, pubkey)).toBe(false);
    const signed = signLiveEvent(sampleEvent);
    expect(verifyLiveEventSignature(signed, "")).toBe(false);
    expect(
      verifyLiveEventSignature({ ...signed, sig: "not-hex" }, pubkey)
    ).toBe(false);
  });
});

describe("canonicalizeLiveEvent", () => {
  it("is key-order independent", () => {
    const a: LiveEvent = { table: "rings", op: "UPDATE", id: "1", ringId: "r1" };
    const b: LiveEvent = { ringId: "r1", id: "1", op: "UPDATE", table: "rings" };
    expect(canonicalizeLiveEvent(a)).toBe(canonicalizeLiveEvent(b));
  });

  it("excludes sig from the signed bytes", () => {
    const signed = signLiveEvent(sampleEvent);
    expect(canonicalizeLiveEvent(signed)).toBe(
      canonicalizeLiveEvent(sampleEvent)
    );
  });

  it("distinguishes nested data payloads", () => {
    const a: LiveEvent = {
      table: "rings",
      op: "UPDATE",
      data: { currentMatchId: "m1" },
    };
    const b: LiveEvent = {
      table: "rings",
      op: "UPDATE",
      data: { currentMatchId: "m2" },
    };
    expect(canonicalizeLiveEvent(a)).not.toBe(canonicalizeLiveEvent(b));
  });
});

describe("parseLiveEvent with signatures", () => {
  it("accepts a signed event", () => {
    const signed = signLiveEvent(sampleEvent);
    expect(parseLiveEvent(signed)).not.toBeNull();
  });

  it("accepts an unsigned event at parse time (hook enforces presence)", () => {
    // The envelope parser stays liberal; useLiveEvents drops unsigned
    // events after the signature check.
    expect(parseLiveEvent(sampleEvent)).not.toBeNull();
  });

  it("rejects a malformed sig", () => {
    expect(
      parseLiveEvent({ ...sampleEvent, sig: "xyz" })
    ).toBeNull();
  });
});
