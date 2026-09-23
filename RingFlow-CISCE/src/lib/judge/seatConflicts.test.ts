/**
 * Regression tests for P9 M-2 (concurrent approvals double-assigning a seat).
 *
 * The DB-level guarantee is the partial unique index
 * `judge_requests_ring_seat_approved_uniq` (UNIQUE (ring_id, seat_number)
 * WHERE status = 'approved') — asserted against the generated migration SQL
 * below. The application-level guarantee is `withSeatConflictRetry`: a 23505
 * from the loser's UPDATE becomes one retry on the next free seat instead of
 * a silent extra vote (or a raw 500).
 *
 * A live two-transaction race needs a real Postgres; these tests simulate the
 * concurrent-approval conflict at the exact boundary the retry logic sees
 * (the 23505 error), plus the migration assertion proving the constraint
 * exists to produce it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isSeatConflictError, withSeatConflictRetry } from "./seatConflicts";

/** A postgres.js-style unique-violation error. */
function uniqueViolation() {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
  });
}

describe("isSeatConflictError", () => {
  it("recognises a bare 23505", () => {
    expect(isSeatConflictError(uniqueViolation())).toBe(true);
  });

  it("recognises a 23505 wrapped in cause chains (drizzle-style)", () => {
    const wrapped = new Error("tx failed", { cause: uniqueViolation() });
    expect(isSeatConflictError(wrapped)).toBe(true);
    const doubleWrapped = new Error("outer", {
      cause: new Error("inner", { cause: uniqueViolation() }),
    });
    expect(isSeatConflictError(doubleWrapped)).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isSeatConflictError(new Error("boom"))).toBe(false);
    expect(
      isSeatConflictError(Object.assign(new Error("x"), { code: "40001" }))
    ).toBe(false);
    expect(isSeatConflictError(null)).toBe(false);
    expect(isSeatConflictError(undefined)).toBe(false);
  });
});

describe("withSeatConflictRetry (concurrent-approval simulation)", () => {
  it("returns the first attempt's result when there is no conflict", async () => {
    let calls = 0;
    const result = await withSeatConflictRetry(async () => {
      calls += 1;
      return { seatNumber: 1 };
    });
    expect(result).toEqual({ seatNumber: 1 });
    expect(calls).toBe(1);
  });

  it("retries once after a seat conflict and returns the new seat", async () => {
    // Simulates: two moderators approve at once, both pick seat 1; the loser
    // gets 23505, retries, and the recompute lands on seat 2.
    let calls = 0;
    const result = await withSeatConflictRetry(async () => {
      calls += 1;
      if (calls === 1) throw uniqueViolation();
      return { seatNumber: 2 };
    });
    expect(result).toEqual({ seatNumber: 2 });
    expect(calls).toBe(2);
  });

  it("throws a clear error when the retry also conflicts", async () => {
    let calls = 0;
    await expect(
      withSeatConflictRetry(async () => {
        calls += 1;
        throw uniqueViolation();
      })
    ).rejects.toThrow(/raced for the same seat/i);
    expect(calls).toBe(2); // exactly one retry, never a loop
  });

  it("propagates non-conflict errors without retrying", async () => {
    let calls = 0;
    await expect(
      withSeatConflictRetry(async () => {
        calls += 1;
        throw new Error("No free judge seats on this ring");
      })
    ).rejects.toThrow("No free judge seats on this ring");
    expect(calls).toBe(1);
  });

  it("propagates a non-conflict error from the retry attempt", async () => {
    let calls = 0;
    await expect(
      withSeatConflictRetry(async () => {
        calls += 1;
        if (calls === 1) throw uniqueViolation();
        throw new Error("Request is already approved");
      })
    ).rejects.toThrow("Request is already approved");
    expect(calls).toBe(2);
  });
});

describe("seat unique index migration (P9 M-2)", () => {
  it("the generated migration creates the partial unique index", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/0004_kata_p9_seat_unique.sql"),
      "utf-8"
    );
    expect(sql).toContain("judge_requests_ring_seat_approved_uniq");
    expect(sql).toMatch(/CREATE UNIQUE INDEX/i);
    // Partial: only approved rows participate, so pending/revoked rows with
    // null/stale seat numbers can never collide.
    expect(sql).toMatch(/WHERE.*"status" = 'approved'/);
    expect(sql).toContain('"ring_id"');
    expect(sql).toContain('"seat_number"');
  });
});
