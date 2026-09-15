import type { MatchState, ScoreValue, Side } from '@event-suite/protocol';
import type { DecisionMethod, Ruleset } from '@event-suite/rules-engine';

/** Everything the reducer needs that is not in the event log itself. */
export interface MatchContext {
  matchId: string;
  /** Bout duration for this category, from the ruleset (Art. 5.1). */
  durationSeconds: number;
  ruleset: Ruleset;
  aka: { registrationId: string | null; displayName: string };
  ao: { registrationId: string | null; displayName: string };
}

export type ScoringProblemCode =
  | 'EXCESSIVE_CHUI'
  | 'SCORE_VALUE_NOT_IN_RULESET'
  | 'VOID_TARGET_NOT_FOUND';

export interface ScoringProblem {
  code: ScoringProblemCode;
  /** Sequence of the event that caused the problem. */
  seq: number;
  message: string;
}

/**
 * What the rules imply about the result, before a human confirms it.
 *
 * `HANTEI_REQUIRED` is not a failure: Art. 12.2.4 says a bout that is level on
 * points, SENSHU, IPPON count and WAZA-ARI count is decided by a majority vote
 * of the panel. The engine cannot invent that vote, so it asks.
 */
export type ProposedOutcome =
  | { kind: 'DECIDED'; side: Side; method: DecisionMethod; reason: string }
  | { kind: 'HANTEI_REQUIRED'; reason: string }
  | { kind: 'HIKIWAKE'; reason: string };

export interface ScoreTally {
  points: number;
  ippon: number;
  wazaAri: number;
  yuko: number;
  chui: number;
}

export function emptyTally(): ScoreTally {
  return { points: 0, ippon: 0, wazaAri: 0, yuko: 0, chui: 0 };
}

/** The score type a numeric value corresponds to under this ruleset (Art. 8.6). */
export function scoreTypeForValue(ruleset: Ruleset, value: ScoreValue): 'YUKO' | 'WAZA_ARI' | 'IPPON' | null {
  for (const [type, configured] of Object.entries(ruleset.scoring)) {
    if (configured === value) {
      return type as 'YUKO' | 'WAZA_ARI' | 'IPPON';
    }
  }
  return null;
}

export type { MatchState };
