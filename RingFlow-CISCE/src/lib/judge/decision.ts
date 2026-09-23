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
import { kataScoresToJudgeInputs, type KataScoreRow } from "./scores";

/** `matches.decision_method` values for kata bouts. */
export const KATA_DECISION_METHODS: Record<KataDecisionMethod, string> = {
  MAJORITY: "KATA_MAJORITY",
  TOTAL_SCORE_TIEBREAK: "KATA_TOTAL_SCORE_TIEBREAK",
  MODERATOR: "KATA_MODERATOR",
  DISQUALIFICATION: "KATA_DISQUALIFICATION",
};

/**
 * Decide a kata bout from its stored score rows.
 *
 * Throws KataDecisionError when there is no countable vote (fewer than one
 * judge submitted both marks) or when votes AND total scores are tied and no
 * moderator decision was supplied — the caller surfaces that to the
 * moderator, who picks the winner (HANTEI).
 */
export function computeBoutDecisionFromRows(
  rows: readonly KataScoreRow[],
  opts: KataBoutOptions = {}
): KataBoutDecision {
  const inputs = kataScoresToJudgeInputs(rows);
  const counted = inputs.filter((j) => j.aka !== null && j.ao !== null).length;
  if (counted < 1) {
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
 * Takes the first-round placeholder slots (ATHLETE slots with no athlete yet)
 * and the advancer ids in `advanceToElimination` order (group winners first,
 * then runners-up, ...), and assigns advancers to TBD slots in bracket order
 * (matchNo, then position). Pure and idempotent: slots that already have an
 * athlete are never touched, and surplus advancers (or a short advancer
 * list) simply stop the plan.
 */
export function planEliminationFillIn(
  slots: readonly PlaceholderSlot[],
  advancerIds: readonly string[]
): FillAssignment[] {
  const targets = slots
    .filter((s) => s.slotType === "ATHLETE" && s.athleteId == null)
    .sort((a, b) => a.matchNo - b.matchNo || a.position - b.position);
  const plan: FillAssignment[] = [];
  for (let i = 0; i < targets.length && i < advancerIds.length; i += 1) {
    const t = targets[i];
    const athleteId = advancerIds[i];
    if (!t || !athleteId) continue;
    plan.push({ matchId: t.matchId, position: t.position, athleteId });
  }
  return plan;
}
