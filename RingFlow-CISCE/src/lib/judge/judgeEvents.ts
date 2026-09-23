/**
 * Live-event builders for the judge flow (P9 H-2).
 *
 * SECURITY: `judge_requests` broadcast events MUST NOT carry the request
 * `id`. Anyone on venue WiFi can subscribe to the anonymous realtime channel;
 * with the id they could harvest pending requestIds and poll
 * /api/judge/status in a loop to steal the victim judge's session cookie the
 * moment the moderator approves. These builders emit only
 * `{ table: "judge_requests", op, ringId, ... }` — no `id`.
 *
 * Nothing breaks: the moderator desk (JudgeDeskClient) subscribes with a
 * `{ ringId }` scope and refetches the pending list on any ring-scoped event,
 * and the judge join page polls /api/judge/status with its own known
 * requestId every 3s instead of relying on the broadcast.
 */

import type { LiveEvent } from "@/lib/realtime/events";

/** A judge submitted a join request: wake the moderator desk to refetch. */
export function judgeRequestInsertedEvent(
  ringId: string,
  judgeName: string,
): LiveEvent {
  return {
    table: "judge_requests",
    op: "INSERT",
    ringId,
    data: { judgeName },
  };
}

/** A judge request changed state (approved / rejected / revoked). */
export function judgeRequestStatusEvent(
  ringId: string,
  status: "approved" | "rejected" | "revoked",
): LiveEvent {
  return {
    table: "judge_requests",
    op: "UPDATE",
    ringId,
    status,
  };
}
