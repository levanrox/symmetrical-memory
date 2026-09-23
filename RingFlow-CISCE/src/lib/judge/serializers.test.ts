/**
 * C1 regression tests for serializeJudgeRequest (src/lib/serializers.ts).
 *
 * The judge_requests table carries a live credential (`sessionToken`) after
 * approval. The serializer must use explicit field selection so the token
 * can never leak into moderator lists or API responses.
 */

import { describe, expect, it } from "vitest";
import { serializeJudgeRequest } from "@/lib/serializers";

const approvedRow = {
  id: "req-1",
  ringId: "ring-1",
  joinCodeUsed: "AB12CD",
  judgeName: "Takeshi",
  seatNumber: 2,
  status: "approved",
  sessionToken: "SUPER-SECRET-TOKEN", // must never appear in output
  expiresAt: new Date("2026-09-24T00:00:00.000Z"),
  createdAt: new Date("2026-09-23T00:00:00.000Z"),
};

describe("serializeJudgeRequest", () => {
  it("never includes the sessionToken credential", () => {
    const out = serializeJudgeRequest(approvedRow);
    expect(out).not.toBeNull();
    expect(JSON.stringify(out)).not.toContain("SUPER-SECRET-TOKEN");
    expect(out).not.toHaveProperty("sessionToken");
    expect(out).not.toHaveProperty("session_token");
  });

  it("exposes only the moderator-relevant fields", () => {
    const out = serializeJudgeRequest(approvedRow);
    expect(out).toEqual({
      id: "req-1",
      ring_id: "ring-1",
      join_code_used: "AB12CD",
      judge_name: "Takeshi",
      seat_number: 2,
      status: "approved",
      expires_at: "2026-09-24T00:00:00.000Z",
      created_at: "2026-09-23T00:00:00.000Z",
    });
  });

  it("handles null rows and null seats", () => {
    expect(serializeJudgeRequest(null)).toBeNull();
    const out = serializeJudgeRequest({ ...approvedRow, seatNumber: null });
    expect(out.seat_number).toBeNull();
  });
});
