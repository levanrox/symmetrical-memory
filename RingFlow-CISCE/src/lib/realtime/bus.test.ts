/**
 * Unit tests for publish-path envelope validation (M3 fix).
 *
 * broadcastLiveEvent validates every event with parseLiveEvent before
 * emitting: a programming error that builds a malformed event is caught
 * here (log-and-drop) instead of being signed, sent, and dropped by every
 * client.
 */
import { describe, expect, it, vi } from "vitest";
import { broadcastLiveEvent, subscribeToLiveEvents, type LiveEvent } from "./bus";

describe("broadcastLiveEvent validation", () => {
  it("emits well-formed events to subscribers", () => {
    const seen: LiveEvent[] = [];
    const unsub = subscribeToLiveEvents((e) => seen.push(e));
    try {
      broadcastLiveEvent({ table: "matches", op: "UPDATE", id: "m1" });
      expect(seen).toHaveLength(1);
      expect(seen[0].id).toBe("m1");
    } finally {
      unsub();
    }
  });

  it("drops malformed events instead of emitting them", () => {
    const seen: LiveEvent[] = [];
    const unsub = subscribeToLiveEvents((e) => seen.push(e));
    try {
      // Empty table violates the schema (min length 1).
      broadcastLiveEvent({ table: "", op: "UPDATE" } as unknown as LiveEvent);
      // Unknown keys violate .strict().
      broadcastLiveEvent({
        table: "matches",
        op: "UPDATE",
        bogus: 1,
      } as unknown as LiveEvent);
      expect(seen).toHaveLength(0);
    } finally {
      unsub();
    }
  });

  it("never throws on malformed input", () => {
    expect(() =>
      broadcastLiveEvent(null as unknown as LiveEvent)
    ).not.toThrow();
    expect(() =>
      broadcastLiveEvent(undefined as unknown as LiveEvent)
    ).not.toThrow();
  });

  it("does not start a LISTEN connection for in-memory broadcast", () => {
    // subscribe/unsubscribe without any DB: start() is async and the
    // connection failure path must not throw synchronously.
    const unsub = subscribeToLiveEvents(vi.fn());
    unsub();
  });
});
