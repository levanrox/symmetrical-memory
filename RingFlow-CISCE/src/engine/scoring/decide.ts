import type { MatchState, Side } from '@event-suite/protocol';
import type { Ruleset } from '@event-suite/rules-engine';
import type { ProposedOutcome, ScoreTally } from './types';

/**
 * Applies the winner criteria of Art. 12.2 in order.
 *
 * The engine resolves everything the score can resolve and stops at HANTEI,
 * which Art. 12.2.4 puts to a majority vote of the four judges and the referee.
 * Inventing that vote would be worse than asking for it, so the function
 * returns `HANTEI_REQUIRED` and the console prompts the operator.
 */
export function proposeOutcome(
  state: MatchState,
  ruleset: Ruleset,
  options: { hikiwakeAllowed?: boolean } = {},
): ProposedOutcome {
  const opponent = (side: Side): Side => (side === 'AKA' ? 'AO' : 'AKA');
  const penaltiesFor = (side: Side) => (side === 'AKA' ? state.penalties.aka : state.penalties.ao);

  // Art. 6 — a side that failed to present themselves is disqualified.
  if (state.kiken !== null) {
    return {
      kind: 'DECIDED',
      side: opponent(state.kiken),
      method: 'KIKEN',
      reason: `${state.kiken} failed to appear`,
    };
  }

  // Art. 10.3 — a disqualification overrides the score. SHIKKAKU first, because
  // it is the more severe of the two.
  for (const level of ['SHIKKAKU', 'HANSOKU'] as const) {
    for (const side of ['AKA', 'AO'] as const) {
      if (penaltiesFor(side).some((penalty) => penalty.level === level)) {
        return {
          kind: 'DECIDED',
          side: opponent(side),
          method: level,
          reason:
            level === 'SHIKKAKU'
              ? `${side} was disqualified from the tournament`
              : `${side} was disqualified from the bout`,
        };
      }
    }
  }

  // Kata: decided by majority flag vote (3 or 5 judges).
  if (state.flags !== undefined && (state.flags.aka > 0 || state.flags.ao > 0)) {
    if (state.flags.aka !== state.flags.ao) {
      const winnerSide: Side = state.flags.aka > state.flags.ao ? 'AKA' : 'AO';
      return {
        kind: 'DECIDED',
        side: winnerSide,
        method: 'FLAGS',
        reason: `${state.flags.aka}–${state.flags.ao} flags majority decision`,
      };
    }
    return { kind: 'HANTEI_REQUIRED', reason: `${state.flags.aka}–${state.flags.ao} flags tied` };
  }

  // Team Kumite: decided by overall bouts won, then total points scored across bouts.
  if (state.teamBouts !== undefined && state.teamBouts.length > 0) {
    let akaWins = 0;
    let aoWins = 0;
    let akaPoints = 0;
    let aoPoints = 0;
    for (const bout of state.teamBouts) {
      if (bout.winner === 'AKA') akaWins += 1;
      else if (bout.winner === 'AO') aoWins += 1;
      akaPoints += bout.akaPoints;
      aoPoints += bout.aoPoints;
    }

    const maxBouts = ruleset.team?.male?.bouts ?? 5;
    const majority = Math.ceil(maxBouts / 2);

    if (akaWins >= majority || aoWins >= majority) {
      const winnerSide: Side = akaWins > aoWins ? 'AKA' : 'AO';
      return {
        kind: 'DECIDED',
        side: winnerSide,
        method: 'POINTS',
        reason: `${akaWins}–${aoWins} bouts (${akaPoints}–${aoPoints} pts)`,
      };
    }

    if (state.teamBouts.length >= maxBouts) {
      if (akaWins !== aoWins) {
        const winnerSide: Side = akaWins > aoWins ? 'AKA' : 'AO';
        return {
          kind: 'DECIDED',
          side: winnerSide,
          method: 'POINTS',
          reason: `${akaWins}–${aoWins} bouts (${akaPoints}–${aoPoints} pts)`,
        };
      }
      if (akaPoints !== aoPoints) {
        const winnerSide: Side = akaPoints > aoPoints ? 'AKA' : 'AO';
        return {
          kind: 'DECIDED',
          side: winnerSide,
          method: 'POINTS',
          reason: `Tied ${akaWins}–${aoWins} bouts; ${akaPoints}–${aoPoints} total points tie-breaker`,
        };
      }
      return {
        kind: 'HANTEI_REQUIRED',
        reason: `Tied on bouts (${akaWins}–${aoWins}) and points (${akaPoints}–${aoPoints}). Deciding bout required.`,
      };
    }
  }

  const aka = state.derived.aka;
  const ao = state.derived.ao;

  // Art. 12.2.1 — the athlete with the highest number of points.
  if (aka.points !== ao.points) {
    const side: Side = aka.points > ao.points ? 'AKA' : 'AO';
    const [high, low] = aka.points > ao.points ? [aka.points, ao.points] : [ao.points, aka.points];

    return { kind: 'DECIDED', side, method: 'POINTS', reason: `${high}-${low} on points` };
  }

  // Level on points: work down the ruleset's tie-break order (Art. 12.2.3-4).
  for (const criterion of ruleset.decision.tieBreakOrder) {
    if (criterion === 'SENSHU') {
      if (ruleset.decision.senshu && state.senshu !== null) {
        return {
          kind: 'DECIDED',
          side: state.senshu,
          method: 'SENSHU',
          reason: 'first unopposed score advantage',
        };
      }
      continue;
    }

    if (criterion === 'HIGHER_IPPON_COUNT' || criterion === 'HIGHER_WAZA_ARI_COUNT') {
      const isIppon = criterion === 'HIGHER_IPPON_COUNT';
      const akaCount = isIppon ? aka.ippon : aka.wazaAri;
      const aoCount = isIppon ? ao.ippon : ao.wazaAri;

      if (akaCount !== aoCount) {
        const side: Side = akaCount > aoCount ? 'AKA' : 'AO';
        const [high, low] = akaCount > aoCount ? [akaCount, aoCount] : [aoCount, akaCount];

        return {
          kind: 'DECIDED',
          side,
          method: 'POINTS',
          reason: `more ${isIppon ? 'IPPON' : 'WAZA ARI'} scored (${high}-${low})`,
        };
      }
      continue;
    }

    // HANTEI — a vote, not a calculation.
    return options.hikiwakeAllowed
      ? { kind: 'HIKIWAKE', reason: 'level on every criterion, and a draw is permitted' }
      : { kind: 'HANTEI_REQUIRED', reason: 'level on every criterion' };
  }

  return options.hikiwakeAllowed
    ? { kind: 'HIKIWAKE', reason: 'no criterion separated the athletes, and a draw is permitted' }
    : { kind: 'HANTEI_REQUIRED', reason: 'no criterion separated the athletes' };
}

/** Convenience for callers that only need the two tallies. */
export function talliesOf(state: MatchState): { aka: ScoreTally; ao: ScoreTally } {
  return { aka: state.derived.aka, ao: state.derived.ao };
}
