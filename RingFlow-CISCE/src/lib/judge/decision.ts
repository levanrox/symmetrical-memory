/**
 * Kata bout decision computation (P3) — pure functions, no DB, no Next.js.
 *
 * Bridges the stored `kata_scores` rows to P1's `decideKataBout` and plans
 * the group-stage elimination fill-in. The DB-loading half lives in
 * src/actions/judge.ts (computeKataBoutDecision) and src/lib/judge/groups.ts.
 */

import {
  decideKataBout,
  KataDecisionError,
  type KataBoutDecision,
  type KataBoutOptions,
  type KataDecisionMethod,
} from "@/engine/rules-engine/rulesets/kata-decision";
import { seedPositions } from "@/engine/draw-engine/sizing";
import { kataScoresToJudgeInputs, type KataScoreRow } from "./scores";

/** `matches.decision_method` values for kata bouts. */
export const KATA_DECISION_METHODS: Record<KataDecisionMethod, string> = {
  MAJORITY: "KATA_MAJORITY",
  TOTAL_SCORE_TIEBREAK: "KATA_TOTAL_SCORE_TIEBREAK",
  MODERATOR: "KATA_MODERATOR",
  DISQUALIFICATION: "KATA_DISQUALIFICATION",
};

/**
 * Extra inputs for {@link computeBoutDecisionFromRows}, beyond the engine's
 * own options.
 */
export interface BoutDecisionExtras {
  /**
   * Seat number -> judge_request id of the seat's CURRENTLY-approved
   * occupant. Seats are re-occupiable mid-event (revoke -> re-approve); only
   * the current occupant's marks count, stale marks from superseded
   * requestIds are ignored. Omit for the legacy judgeRequestId grouping
   * (pure unit tests).
   */
  currentBySeat?: ReadonlyMap<number, string> | null;
  /**
   * Side disqualified for this bout ('AKA' | 'AO'). The engine zeroes the
   * disqualified side's marks and awards the bout to the opponent
   * (Art. 5.4.1) — this is the only legal way a 0.0 enters a decision, since
   * 0.0 can never be stored as a mark.
   */
  disqualifiedSide?: "AKA" | "AO" | null;
}

/**
 * Decide a kata bout from its stored score rows.
 *
 * Throws KataDecisionError when there is no countable vote (fewer than one
 * judge submitted both marks) or when votes AND total scores are tied and no
 * moderator decision was supplied — the caller surfaces that to the
 * moderator, who picks the winner (HANTEI). A disqualified side overrides
 * everything: the bout is decided even with zero counted votes.
 */
export function computeBoutDecisionFromRows(
  rows: readonly KataScoreRow[],
  opts: KataBoutOptions = {},
  extras: BoutDecisionExtras = {}
): KataBoutDecision {
  const inputs = kataScoresToJudgeInputs(rows, extras.currentBySeat ?? null);
  const dq = extras.disqualifiedSide ?? null;
  if (dq === "AKA" || dq === "AO") {
    // The DQ flag lives on the engine's KataJudgeScore input: the engine
    // zeroes the disqualified side's marks and awards the bout to the
    // opponent regardless of votes. Stamp every judge input; when no marks
    // exist yet (DQ called during a scoreless bout) a synthetic input carries
    // the flag so the decision still resolves.
    if (inputs.length === 0) {
      inputs.push({ judgeId: "__dq__", aka: null, ao: null, disqualified: dq });
    } else {
      for (const j of inputs) j.disqualified = dq;
    }
  }
  const counted = inputs.filter((j) => j.aka !== null && j.ao !== null).length;
  if (counted < 1 && dq === null) {
    throw new KataDecisionError(
      "At least one counted judge vote is required to decide this bout."
    );
  }
  return decideKataBout(inputs, opts);
}

export interface PlaceholderSlot {
  matchId: string;
  matchNo: number;
  position: 1 | 2;
  slotType: string;
  athleteId: string | null;
}

export interface FillAssignment {
  matchId: string;
  position: 1 | 2;
  athleteId: string;
}

/**
 * Plan the elimination-bracket fill-in after a group stage completes.
 *
 * Takes the first-round placeholder slots and the advancer ids in
 * `advanceToElimination` order (strongest first: group winners, then
 * runners-up, ...), and assigns each advancer to the bracket slot that
 * standard seeding reserves for their seed: bracket position `p` hosts seed
 * `seedPositions(size)[p]`, and seed `k` belongs to the k-th advancer.
 * Seeds past the advancer count are structural BYE slots (never ATHLETE
 * targets), so winners meet runners-up in round one — never winner-vs-winner.
 *
 * Pure and idempotent: slots that already have an athlete are never touched,
 * and surplus advancers (or a short advancer list) simply stop the plan.
 */
export function planEliminationFillIn(
  slots: readonly PlaceholderSlot[],
  advancerIds: readonly string[]
): FillAssignment[] {
  // Bracket order: the n-th slot in (matchNo, position) order is bracket
  // position n, and seedPositions(size)[n] is the seed hosted there.
  const ordered = [...slots].sort(
    (a, b) => a.matchNo - b.matchNo || a.position - b.position
  );
  const positions = seedPositions(ordered.length);
  const plan: FillAssignment[] = [];
  for (let p = 0; p < ordered.length; p += 1) {
    const s = ordered[p];
    if (!s || s.slotType !== "ATHLETE" || s.athleteId != null) continue;
    const seed = positions[p] ?? 0;
    // Seed k <- the k-th advancer (advancerIds is strongest-first).
    const athleteId = seed >= 1 ? advancerIds[seed - 1] : undefined;
    if (!athleteId) continue;
    plan.push({ matchId: s.matchId, position: s.position, athleteId });
  }
  return plan;
}
