/**
 * Regression tests for P9 H-2 (judge session theft via realtime broadcast).
 *
 * `judge_requests` broadcast events must NEVER carry the request `id`:
 * anyone on venue WiFi can subscribe to the anonymous realtime channel, and
 * with the id they could poll /api/judge/status to steal the victim judge's
 * session cookie the moment the moderator approves.
 */

import { describe, expect, it } from "vitest";
import { parseLiveEvent } from "@/lib/realtime/events";
import {
  judgeRequestInsertedEvent,
  judgeRequestStatusEvent,
} from "./judgeEvents";

describe("judgeRequestInsertedEvent (P9 H-2)", () => {
  it("contains no request id", () => {
    const event = judgeRequestInsertedEvent("ring-1", "Aarav Sharma");
    expect(event).toEqual({
      table: "judge_requests",
      op: "INSERT",
      ringId: "ring-1",
      data: { judgeName: "Aarav Sharma" },
    });
    expect("id" in event).toBe(false);
    expect(event.id).toBeUndefined();
  });

  it("still passes the strict live-event envelope (id is optional)", () => {
    expect(parseLiveEvent(judgeRequestInsertedEvent("ring-1", "Aarav"))).not.toBeNull();
  });
});

describe("judgeRequestStatusEvent (P9 H-2)", () => {
  it.each(["approved", "rejected", "revoked"] as const)(
    "carries no request id for status %s",
    (status) => {
      const event = judgeRequestStatusEvent("ring-1", status);
      expect(event).toEqual({
        table: "judge_requests",
        op: "UPDATE",
        ringId: "ring-1",
        status,
      });
      expect("id" in event).toBe(false);
      expect(parseLiveEvent(event)).not.toBeNull();
    }
  );
});
