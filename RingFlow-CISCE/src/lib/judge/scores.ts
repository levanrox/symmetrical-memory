/**
 * Kata score helpers (P3) — pure functions, no DB, no Next.js.
 *
 * Marks are carried as integer tenths (50-100) so 0.1-step arithmetic stays
 * exact. Validation reuses P1's `validateJudgeScore` (WKF Kata Rules 2026.0
 * Art. 5.4.1: 5.0-10.0 in 0.1 steps).
 */

import {
  validateJudgeScore,
  type KataJudgeScore,
} from "@/engine/rules-engine/rulesets/kata-decision";

export const KATA_SIDES = ["AKA", "AO"] as const;
export type KataSide = (typeof KATA_SIDES)[number];

/** Parse and validate a bout side. Throws on anything but AKA/AO. */
export function parseKataSide(raw: unknown): KataSide {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (s === "AKA" || s === "AO") return s;
  throw new Error('Invalid side: expected "AKA" or "AO"');
}

/**
 * Validate a judge's mark and return integer tenths.
 * Accepts numbers or numeric strings; throws on anything outside
 * 5.0-10.0 in 0.1 steps (NaN, 4.9, 7.55, 10.1, ...).
 */
export function scoreToTenths(score: unknown): number {
  const n = typeof score === "string" && score.trim() !== "" ? Number(score) : score;
  if (!validateJudgeScore(n as number)) {
    throw new Error("Invalid score: must be 5.0-10.0 in 0.1 steps");
  }
  return Math.round((n as number) * 10);
}

/** One row of the `kata_scores` table, as read for decision computation. */
export interface KataScoreRow {
  judgeRequestId: string;
  seatNumber: number;
  side: string;
  scoreTenths: number;
}

/**
 * Group raw `kata_scores` rows into P1 `KataJudgeScore` input: one entry per
 * distinct judge, with `aka`/`ao` null until that side is submitted. P1's
 * `decideKataBout` excludes half-votes (only one side submitted) from the
 * vote count — this mapping preserves that by keeping the missing side
 * null rather than defaulting it.
 *
 * Seats are re-occupiable mid-event (revoke -> re-approve): when
 * `currentBySeat` (seatNumber -> judge_request id of the seat's
 * currently-approved occupant) is given, marks from superseded requestIds
 * are IGNORED, so a revoked judge's stale marks can never split the vote
 * against their replacement's. The moderator tally applies the same rule —
 * both sides of the screen must agree on whose marks are in. Without the
 * map the legacy judgeRequestId grouping is used (pure unit tests).
 */
export function kataScoresToJudgeInputs(
  rows: readonly KataScoreRow[],
  currentBySeat?: ReadonlyMap<number, string> | null
): KataJudgeScore[] {
  const byJudge = new Map<string, KataJudgeScore>();
  for (const r of rows) {
    if (currentBySeat) {
      // Only the seat's current occupant counts. Seats with no approved
      // occupant have no legitimate marks — moderator manual entry creates
      // an approved placeholder row, so it matches too.
      if (currentBySeat.get(r.seatNumber) !== r.judgeRequestId) continue;
    }
    let entry = byJudge.get(r.judgeRequestId);
    if (!entry) {
      entry = { judgeId: r.judgeRequestId, aka: null, ao: null };
      byJudge.set(r.judgeRequestId, entry);
    }
    const mark = r.scoreTenths / 10;
    if (r.side === "AKA") entry.aka = mark;
    else if (r.side === "AO") entry.ao = mark;
    // Unknown side values are ignored: they can never validate at write time,
    // so this is dead-defensive rather than load-bearing.
  }
  return [...byJudge.values()];
}

/** How many judges submitted BOTH marks (i.e. cast a countable vote). */
export function countCompleteVotes(rows: readonly KataScoreRow[]): number {
  return kataScoresToJudgeInputs(rows).filter((j) => j.aka !== null && j.ao !== null).length;
}

export type ScoreWritePlan = "duplicate" | "insert" | "update";

/**
 * Pure idempotency decision for a score write (unit-testable):
 * - a row already carrying the client's idempotency key -> "duplicate"
 *   (return the original row, write nothing);
 * - otherwise a row for (matchId, judgeRequestId, side) exists -> "update"
 *   (judge correcting their mark);
 * - otherwise -> "insert".
 */
export function planScoreWrite(
  existingByKey: { id: string } | null,
  existingByScope: { id: string } | null
): ScoreWritePlan {
  if (existingByKey) return "duplicate";
  return existingByScope ? "update" : "insert";
}

export interface JudgeScoreScope {
  /** Ring the judge's session is bound to. */
  judgeRingId: string;
  /** Ring actually running the match's category (null when unassigned). */
  matchRingId: string | null;
  matchStatus: string | null;
  /** The ring's active-bout pointer. */
  ringCurrentMatchId: string | null;
  matchId: string;
}

/**
 * Pure scope check for a judge score write (unit-testable).
 *
 * A judge token authorizes scores for exactly ONE thing: the ACTIVE live
 * bout on their own ring. Throws otherwise.
 */
export function assertJudgeScoreScope(scope: JudgeScoreScope): void {
  if (!scope.matchRingId || scope.matchRingId !== scope.judgeRingId) {
    throw new Error("This bout is not running on your ring");
  }
  if (scope.matchStatus !== "LIVE") {
    throw new Error("Scores can only be submitted for the live bout");
  }
  if (scope.ringCurrentMatchId !== scope.matchId) {
    throw new Error("Scores can only be submitted for the active bout");
  }
}
