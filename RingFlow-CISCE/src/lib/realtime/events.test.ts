/**
 * Unit tests for the realtime broadcast envelope (src/lib/realtime/events.ts).
 *
 * The strict zod schema is a security boundary: malformed or hostile
 * broadcast payloads must never reach the scope matcher.
 */

import { describe, expect, it } from "vitest";
import {
  parseLiveEvent,
  eventMatchesScope,
  type LiveEvent,
  type LiveScope,
} from "./events";

const validScoreEvent = {
  table: "matches",
  op: "UPDATE",
  matchId: "m-123",
  ringId: "ring-1",
  tournamentId: "t-1",
  categoryId: "c-1",
  akaScore: 3,
  aoScore: 2,
  akaPenalties: 0,
  aoPenalties: 1,
  senshu: "aka",
  status: "live",
};

describe("parseLiveEvent", () => {
  it("accepts a valid envelope", () => {
    const ev = parseLiveEvent(validScoreEvent);
    expect(ev).not.toBeNull();
    expect(ev?.table).toBe("matches");
    expect(ev?.op).toBe("UPDATE");
    expect(ev?.akaScore).toBe(3);
  });

  it("accepts the minimal envelope (table + op only)", () => {
    expect(parseLiveEvent({ table: "rings", op: "INSERT" })).not.toBeNull();
  });

  it("rejects unknown event ops", () => {
    expect(parseLiveEvent({ table: "matches", op: "MERGE" })).toBeNull();
  });

  it("rejects missing required fields", () => {
    expect(parseLiveEvent({ op: "UPDATE" })).toBeNull();
    expect(parseLiveEvent({ table: "matches" })).toBeNull();
    expect(parseLiveEvent(null)).toBeNull();
    expect(parseLiveEvent("not-an-object")).toBeNull();
  });

  it("rejects extra fields (strict mode)", () => {
    expect(
      parseLiveEvent({ ...validScoreEvent, sessionToken: "evil-token" })
    ).toBeNull();
    expect(
      parseLiveEvent({ ...validScoreEvent, unexpected: 123 })
    ).toBeNull();
  });

  it("rejects wrong types", () => {
    expect(parseLiveEvent({ ...validScoreEvent, akaScore: "3" })).toBeNull();
    expect(
      parseLiveEvent({ ...validScoreEvent, akaScore: 3.5 })
    ).toBeNull();
  });

  it("rejects overlong fields", () => {
    expect(
      parseLiveEvent({ table: "x".repeat(65), op: "UPDATE" })
    ).toBeNull();
  });
});

function ev(overrides: Partial<LiveEvent>): LiveEvent {
  return { table: "matches", op: "UPDATE", ...overrides };
}

describe("eventMatchesScope", () => {
  it("matches a ring-scoped screen only for its own ring", () => {
    const scope: LiveScope = { ringId: "ring-1" };
    expect(eventMatchesScope(ev({ ringId: "ring-1" }), scope)).toBe(true);
    expect(eventMatchesScope(ev({ ringId: "ring-2" }), scope)).toBe(false);
    expect(eventMatchesScope(ev({}), scope)).toBe(false);
  });

  it("matches a request-scoped screen by event id", () => {
    const scope: LiveScope = { requestId: "req-9" };
    expect(eventMatchesScope(ev({ id: "req-9" }), scope)).toBe(true);
    expect(eventMatchesScope(ev({ id: "req-10" }), scope)).toBe(false);
  });

  it("matches a category-scoped screen by categoryId or categories-table id", () => {
    const scope: LiveScope = { categoryId: "c-5" };
    expect(eventMatchesScope(ev({ categoryId: "c-5" }), scope)).toBe(true);
    expect(
      eventMatchesScope(ev({ table: "categories", id: "c-5" }), scope)
    ).toBe(true);
    expect(eventMatchesScope(ev({ categoryId: "c-6" }), scope)).toBe(false);
  });

  it("matches a tournament-scoped screen broadly", () => {
    const scope: LiveScope = { tournamentId: "t-1" };
    expect(eventMatchesScope(ev({ tournamentId: "t-1" }), scope)).toBe(true);
    expect(eventMatchesScope(ev({}), scope)).toBe(true);
  });

  it("matches everything for an empty scope", () => {
    expect(eventMatchesScope(ev({ ringId: "r" }), {})).toBe(true);
  });

  it("prefers ring scope over tournament scope", () => {
    const scope: LiveScope = { ringId: "ring-1", tournamentId: "t-1" };
    expect(
      eventMatchesScope(ev({ ringId: "ring-2", tournamentId: "t-1" }), scope)
    ).toBe(false);
  });
});
