import type { MatchEvent, MatchState, PenaltyLevel, Side } from '@event-suite/protocol';
import type { Ruleset } from '@event-suite/rules-engine';
import { reduceMatch } from './reduce';
import type { MatchContext } from './types';

/**
 * How far up the penalty ladder this athlete has already climbed.
 *
 * Each athlete carries their own ladder, which is why this takes a side: AKA
 * sitting on a second CHUI says nothing about AO.
 *
 * Only the rungs that *precede* disqualification count. Once HANSOKU lands the
 * bout is over, so there is nothing further to advance.
 */
export function penaltiesTaken(state: MatchState, side: Side): number {
  const records = side === 'AKA' ? state.penalties.aka : state.penalties.ao;

  return records.filter(
    (record) => record.level === 'CHUI' || record.level === 'HANSOKU_CHUI',
  ).length;
}

export interface PenaltyProgress {
  /** Rungs already consumed. */
  taken: number;
  /** Rungs in the ladder before the athlete is out. */
  total: number;
  /** What the next penalty will be. */
  next: PenaltyLevel;
  /** Whether taking it ends the bout and gives it to the opponent. */
  endsBout: boolean;
}

/**
 * Where an athlete stands on the penalty ladder, and what comes next.
 *
 * WKF Art. 10.2-10.3: CHUI may be given up to three times, then HANSOKU CHUI,
 * then HANSOKU, which disqualifies from the bout and gives it to the opponent.
 * The sequence is read from the ruleset rather than hardcoded, so a federation
 * that orders it differently changes data, not code.
 *
 * The ladder is positional: the nth penalty takes the nth rung.
 */
export function penaltyProgress(
  state: MatchState | null,
  side: Side,
  ruleset: Ruleset,
): PenaltyProgress {
  const ladder = ruleset.penalties.escalation;
  const taken = state === null ? 0 : penaltiesTaken(state, side);
  const index = Math.min(taken, ladder.length - 1);
  const next = ladder[index] ?? 'HANSOKU';
  const last = ladder.at(-1) ?? 'HANSOKU';

  return { taken, total: ladder.length, next, endsBout: next === last && next === 'HANSOKU' };
}

/**
 * The level an operator's next penalty tap should record.
 *
 * This is the whole point of resolving it here rather than in the console: a
 * scorer taps "penalty", and the software decides whether that is the second
 * CHUI or the disqualification. A console cannot mis-tap a level it never
 * chooses.
 *
 * Accepts a null state, because the first penalty of a bout arrives before the
 * match has any events at all.
 */
export function nextPenaltyLevel(
  state: MatchState | null,
  side: Side,
  ruleset: Ruleset,
): PenaltyLevel {
  return penaltyProgress(state, side, ruleset).next;
}

/** The wording a referee would use, including the 1C/2C/3C the sheet records. */
export function penaltyLabel(level: PenaltyLevel, ordinal: number): string {
  if (level === 'CHUI') return `CHUI ${ordinal}`;
  if (level === 'HANSOKU_CHUI') return 'HANSOKU CHUI';
  if (level === 'HANSOKU') return 'HANSOKU';
  return 'SHIKKAKU';
}

/** Convenience for callers holding an event log rather than a reduced state. */
export function penaltyProgressFromEvents(
  events: readonly MatchEvent[],
  context: MatchContext,
  side: Side,
): PenaltyProgress {
  const { state } = reduceMatch(events, context);
  return penaltyProgress(state, side, context.ruleset);
}
