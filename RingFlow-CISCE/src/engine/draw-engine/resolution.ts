import type { Side } from '@event-suite/rules-engine';
import type { DrawGraph, MatchNode, Round, SlotNode, SlotPosition } from './types';

/**
 * A confirmed result for one match.
 *
 * The winner is named by *side* (AKA/AO), not by athlete id. The resolver
 * already knows who occupies each slot — working it out is what resolution
 * does — so asking callers to supply the athlete would force them to re-derive
 * advancement from outside, which is impossible for any round after the first.
 */
export type MatchOutcome =
  | { kind: 'WINNER'; side: Side }
  /** A draw. Legal only where the ruleset permits it (Art. 12.2.5). */
  | { kind: 'HIKIWAKE' }
  /** Both athletes disqualified (Art. 12.2.11): no winner advances. */
  | { kind: 'DOUBLE_DISQUALIFICATION' };

export type ResolutionProblemCode =
  | 'HIKIWAKE_NOT_ALLOWED'
  | 'RESULT_FOR_UNPLAYED_MATCH'
  | 'DOUBLE_DISQUALIFICATION_IN_MEDAL_BOUT';

export interface ResolutionProblem {
  code: ResolutionProblemCode;
  matchId: string;
  message: string;
}

export type ResolvedMatchStatus = 'PENDING' | 'READY' | 'FINISHED' | 'WALKOVER' | 'UNRESOLVED';

export interface ResolvedSlot {
  slotId: string;
  position: SlotPosition;
  registrationId: string | null;
  source: 'ATHLETE' | 'BYE' | 'WINNER_OF' | 'LOSER_OF' | 'PENDING';
  /** The match this slot draws from, when it draws from one. */
  sourceMatchId: string | null;
}

export interface ResolvedMatch {
  matchId: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: MatchNode['bracketType'];
  status: ResolvedMatchStatus;
  slots: readonly [ResolvedSlot, ResolvedSlot];
  winnerRegistrationId: string | null;
  loserRegistrationId: string | null;
}

export interface Podium {
  goldRegistrationId: string;
  silverRegistrationId: string | null;
  bronzeRegistrationIds: readonly string[];
}

export interface ResolutionResult {
  matches: readonly ResolvedMatch[];
  /** Matches with two athletes and no result yet — this drives the ring queue. */
  readyMatchIds: readonly string[];
  /** Matches decided without a contest because of a bye. */
  walkoverMatchIds: readonly string[];
  completedMatchIds: readonly string[];
  podium: Podium | null;
  problems: readonly ResolutionProblem[];
}

interface Fill {
  settled: boolean;
  registrationId: string | null;
  source: ResolvedSlot['source'];
  sourceMatchId: string | null;
}

function fill(
  settled: boolean,
  registrationId: string | null,
  source: ResolvedSlot['source'],
  sourceMatchId: string | null = null,
): Fill {
  return { settled, registrationId, source, sourceMatchId };
}

/**
 * Resolves a draw against its confirmed results (blueprint §5.2).
 *
 * Pure and idempotent: running it twice produces the same output, and it never
 * mutates the graph. That is what lets a ring recover after a browser crash —
 * or the whole event after a server restart — by simply re-running resolution
 * over the event log rather than repairing state by hand.
 *
 * Rounds are walked in order, so a match's inputs are always resolved before
 * the match itself. Byes cascade: a match with two empty slots yields no winner
 * *and* no loser, which propagates as a bye to the next round. That single rule
 * is what makes an under-filled category work all the way to a gold medallist
 * without special cases.
 */
export function resolveDraw(
  graph: DrawGraph,
  results: ReadonlyMap<string, MatchOutcome>,
): ResolutionResult {
  const slotsByMatch = indexSlots(graph);
  const matchById = new Map(graph.matches.map((match) => [match.id, match]));
  const resolved = new Map<string, ResolvedMatch>();
  const problems: ResolutionProblem[] = [];

  // Repechage and bronze matches are separated from the main bracket because
  // their entrants are only knowable once the main bracket has been resolved.
  const isAncillary = (round: Round): boolean =>
    round.matchIds.some((id) => matchById.get(id)?.bracketType !== 'MAIN');

  const runRound = (round: Round, lines: RepechageLines | null): void => {
    for (const matchId of round.matchIds) {
      const match = mustMatch(graph, matchId);
      const [slotA, slotB] = slotsByMatch.get(matchId) ?? [];

      if (slotA === undefined || slotB === undefined) {
        throw new Error(`Internal error: match ${matchId} does not have two slots`);
      }

      const fillA = resolveSlot(slotA, resolved, lines);
      const fillB = resolveSlot(slotB, resolved, lines);

      resolved.set(matchId, buildMatch(match, fillA, fillB, results, graph, problems));
    }
  };

  for (const round of graph.rounds) {
    if (!isAncillary(round)) runRound(round, null);
  }

  const lines = buildRepechageLines(graph, resolved);

  for (const round of graph.rounds) {
    if (isAncillary(round)) runRound(round, lines);
  }

  const matches = graph.matches.map((match) => mustResolved(resolved, match.id));

  return {
    matches,
    readyMatchIds: matches.filter((m) => m.status === 'READY').map((m) => m.matchId),
    walkoverMatchIds: matches.filter((m) => m.status === 'WALKOVER').map((m) => m.matchId),
    completedMatchIds: matches.filter((m) => m.status === 'FINISHED').map((m) => m.matchId),
    podium: computePodium(graph, resolved),
    problems,
  };
}

/** Round number to the loser that round's match contributes to a repechage line. */
type RepechageLines = ReadonlyMap<'A' | 'B', ReadonlyMap<number, string | null>>;

/**
 * Works out who sits on each repechage rung, by tracing the path each finalist
 * actually took.
 *
 * A finalist's line is everyone they beat, keyed by the round they beat them in.
 * Returns null while the semifinals are undecided, which leaves the rungs
 * pending rather than guessing.
 */
function buildRepechageLines(
  graph: DrawGraph,
  resolved: ReadonlyMap<string, ResolvedMatch>,
): RepechageLines | null {
  const final = graph.matches
    .filter((match) => match.bracketType === 'MAIN')
    .reduce<MatchNode | null>(
      (best, match) => (best === null || match.roundNo > best.roundNo ? match : best),
      null,
    );

  if (final === null) return null;

  const finalResolved = resolved.get(final.id);
  if (finalResolved === undefined) return null;

  const lineA = traceLine(finalResolved, 1, resolved);
  const lineB = traceLine(finalResolved, 2, resolved);

  if (lineA === null || lineB === null) return null;

  return new Map([
    ['A', lineA],
    ['B', lineB],
  ]);
}

function traceLine(
  finalMatch: ResolvedMatch,
  position: SlotPosition,
  resolved: ReadonlyMap<string, ResolvedMatch>,
): ReadonlyMap<number, string | null> | null {
  const halfFinalId = finalMatch.slots.find((slot) => slot.position === position)?.sourceMatchId;
  if (halfFinalId === null || halfFinalId === undefined) return null;

  const halfFinal = resolved.get(halfFinalId);
  if (halfFinal === undefined || !producedDecision(halfFinal)) return null;

  const finalist = halfFinal.winnerRegistrationId;
  if (finalist === null) return null;

  const rungs = new Map<number, string | null>();
  let current: string | null = halfFinalId;

  while (current !== null) {
    const match = resolved.get(current);
    if (match === undefined) break;

    // A walkover has no loser, so this rung stays empty and cascades forward.
    rungs.set(match.roundNo, match.loserRegistrationId);

    const winnerSlot = match.slots.find(
      (slot) => slot.sourceMatchId !== null && slot.registrationId === finalist,
    );
    current = winnerSlot?.sourceMatchId ?? null;
  }

  return rungs;
}

function buildMatch(
  match: MatchNode,
  fillA: Fill,
  fillB: Fill,
  results: ReadonlyMap<string, MatchOutcome>,
  graph: DrawGraph,
  problems: ResolutionProblem[],
): ResolvedMatch {
  const slots = [
    {
      slotId: `${match.id}:S1`,
      position: 1 as const,
      registrationId: fillA.registrationId,
      source: fillA.source,
      sourceMatchId: fillA.sourceMatchId,
    },
    {
      slotId: `${match.id}:S2`,
      position: 2 as const,
      registrationId: fillB.registrationId,
      source: fillB.source,
      sourceMatchId: fillB.sourceMatchId,
    },
  ] as const;

  const base = {
    matchId: match.id,
    matchNo: match.matchNo,
    roundNo: match.roundNo,
    roundName: match.roundName,
    bracketType: match.bracketType,
    slots,
  };

  if (!fillA.settled || !fillB.settled) {
    return { ...base, status: 'PENDING', winnerRegistrationId: null, loserRegistrationId: null };
  }

  const athleteA = fillA.registrationId;
  const athleteB = fillB.registrationId;
  const outcome = results.get(match.id);

  // Nobody in either slot: an empty match. No result is possible and nothing
  // advances, which cascades the bye to the next round.
  if (athleteA === null && athleteB === null) {
    return { ...base, status: 'UNRESOLVED', winnerRegistrationId: null, loserRegistrationId: null };
  }

  // One athlete only: a walkover, decided without a contest.
  if (athleteA === null || athleteB === null) {
    const advancing = athleteA ?? athleteB;

    if (outcome !== undefined) {
      problems.push({
        code: 'RESULT_FOR_UNPLAYED_MATCH',
        matchId: match.id,
        message: 'a result was recorded for a match that is a walkover',
      });
    }

    return { ...base, status: 'WALKOVER', winnerRegistrationId: advancing, loserRegistrationId: null };
  }

  if (outcome === undefined) {
    return { ...base, status: 'READY', winnerRegistrationId: null, loserRegistrationId: null };
  }

  if (outcome.kind === 'HIKIWAKE') {
    // Art. 12.2.5: an individual elimination bout cannot be declared a tie.
    if (graph.format === 'SINGLE_ELIM_REPECHAGE' || graph.format === 'DOUBLE_ELIM') {
      problems.push({
        code: 'HIKIWAKE_NOT_ALLOWED',
        matchId: match.id,
        message: 'an elimination bout cannot be drawn; a winner must be decided',
      });
    }

    return { ...base, status: 'FINISHED', winnerRegistrationId: null, loserRegistrationId: null };
  }

  if (outcome.kind === 'DOUBLE_DISQUALIFICATION') {
    // Art. 12.2.11: neither advances and the next round is won by bye. In a
    // medal bout that is not the whole story — the rules fall back to the score
    // at the moment of disqualification, then SENSHU, then HANTEI — so the
    // operator has to decide rather than the engine guessing.
    if (match.roundName === 'Final' || match.bracketType === 'BRONZE') {
      problems.push({
        code: 'DOUBLE_DISQUALIFICATION_IN_MEDAL_BOUT',
        matchId: match.id,
        message:
          'both athletes were disqualified in a medal bout; the winner must be decided by the referee panel (Art. 12.2.11)',
      });
    }

    return { ...base, status: 'FINISHED', winnerRegistrationId: null, loserRegistrationId: null };
  }

  const { side } = outcome;
  const winnerRegistrationId = side === 'AKA' ? athleteA : athleteB;
  const loserRegistrationId = side === 'AKA' ? athleteB : athleteA;

  return { ...base, status: 'FINISHED', winnerRegistrationId, loserRegistrationId };
}

/**
 * True once a match can no longer change who advances from it.
 *
 * A match that is merely `READY` has not been fought, so its downstream slots
 * are still *pending* — not empty. Conflating the two would turn every
 * not-yet-played match into a phantom walkover downstream.
 */
function producedDecision(match: ResolvedMatch): boolean {
  return match.status === 'FINISHED' || match.status === 'WALKOVER' || match.status === 'UNRESOLVED';
}

function resolveSlot(
  slot: SlotNode,
  resolved: ReadonlyMap<string, ResolvedMatch>,
  lines: RepechageLines | null,
): Fill {
  switch (slot.slotType) {
    case 'ATHLETE':
      return fill(true, slot.registrationId, 'ATHLETE');

    case 'BYE':
      return fill(true, null, 'BYE');

    case 'WINNER_OF': {
      const source = sourceMatch(slot, resolved);
      if (source === undefined || !producedDecision(source)) {
        return fill(false, null, 'PENDING', slot.sourceMatchId);
      }

      // Null here is meaningful: an empty match or a double disqualification
      // advances nobody, which cascades as a bye.
      return fill(true, source.winnerRegistrationId, 'WINNER_OF', slot.sourceMatchId);
    }

    case 'LOSER_OF': {
      const source = sourceMatch(slot, resolved);
      if (source === undefined || !producedDecision(source)) {
        return fill(false, null, 'PENDING', slot.sourceMatchId);
      }

      // A walkover has no loser, so the downstream slot stays empty.
      return fill(true, source.loserRegistrationId, 'LOSER_OF', slot.sourceMatchId);
    }

    case 'REPECHAGE': {
      const rule = slot.repechageRule;

      // Unbound until the semifinals name both finalists, so that a rung is
      // never filled with a guess.
      if (rule === null || lines === null) {
        return fill(false, null, 'PENDING');
      }

      const line = lines.get(rule.line);
      if (line === undefined || !line.has(rule.roundNo)) {
        return fill(false, null, 'PENDING');
      }

      // A null here is a rung whose match was a walkover: the bye cascades.
      return fill(true, line.get(rule.roundNo) ?? null, 'LOSER_OF');
    }

    default:
      return fill(false, null, 'PENDING');
  }
}

function sourceMatch(
  slot: SlotNode,
  resolved: ReadonlyMap<string, ResolvedMatch>,
): ResolvedMatch | undefined {
  if (slot.sourceMatchId === null) return undefined;
  return resolved.get(slot.sourceMatchId);
}

function computePodium(
  graph: DrawGraph,
  resolved: ReadonlyMap<string, ResolvedMatch>,
): Podium | null {
  const final = graph.matches.find((match) => match.roundName === 'Final' && match.bracketType === 'MAIN');

  if (final === undefined) return null;

  const finalResult = resolved.get(final.id);
  if (finalResult === undefined || finalResult.winnerRegistrationId === null) return null;

  let bronze = graph.matches
    .filter((match) => match.bracketType === 'BRONZE')
    .map((match) => resolved.get(match.id))
    .map((match) => match?.winnerRegistrationId ?? null)
    .filter((id): id is string => id !== null);

  if (bronze.length === 0 && graph.bronzeMedals === 3) {
    // Local Official: both semifinal losers receive bronze directly
    const semiIds = finalResult.slots
      .map((s) => s.sourceMatchId)
      .filter((id): id is string => Boolean(id));

    bronze = semiIds
      .map((id) => resolved.get(id)?.loserRegistrationId ?? null)
      .filter((id): id is string => id !== null);
  }

  return {
    goldRegistrationId: finalResult.winnerRegistrationId,
    silverRegistrationId: finalResult.loserRegistrationId,
    bronzeRegistrationIds: bronze,
  };
}

function indexSlots(graph: DrawGraph): Map<string, SlotNode[]> {
  const byMatch = new Map<string, SlotNode[]>();

  for (const slot of graph.slots) {
    const existing = byMatch.get(slot.matchId) ?? [];
    existing.push(slot);
    byMatch.set(slot.matchId, existing);
  }

  for (const [matchId, slots] of byMatch) {
    byMatch.set(
      matchId,
      [...slots].sort((a, b) => a.position - b.position),
    );
  }

  return byMatch;
}

function mustMatch(graph: DrawGraph, matchId: string): MatchNode {
  const match = graph.matches.find((candidate) => candidate.id === matchId);
  if (match === undefined) {
    throw new Error(`Internal error: match ${matchId} is not in the graph`);
  }
  return match;
}

function mustResolved(resolved: ReadonlyMap<string, ResolvedMatch>, matchId: string): ResolvedMatch {
  const match = resolved.get(matchId);
  if (match === undefined) {
    throw new Error(`Internal error: match ${matchId} was never resolved`);
  }
  return match;
}
