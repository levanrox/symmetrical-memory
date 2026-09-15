import type { DecisionMethod, MatchEvent, MatchState, OutcomeSide, PenaltyRecord, Side } from '@event-suite/protocol';
import {
  emptyTally,
  scoreTypeForValue,
  type MatchContext,
  type ScoreTally,
  type ScoringProblem,
} from './types';


/**
 * Reduces a match's event log into its current state.
 *
 * Pure and deterministic: the same log always yields the same state, with no
 * clock reads. That is what makes a live match recoverable — after a crash the
 * server re-reduces the log rather than repairing a mutable score column — and
 * it is why undo is possible at all: voiding an event and reducing again is the
 * whole mechanism (blueprint §7.2).
 *
 * Events are applied in `seq` order regardless of the order supplied, and any
 * event named by an `EVENT_VOID` is skipped.
 */
export function reduceMatch(
  events: readonly MatchEvent[],
  context: MatchContext,
): { state: MatchState; problems: ScoringProblem[] } {
  const problems: ScoringProblem[] = [];

  // Voids are collected first: a void may name an event that appears later in
  // the array, so a single pass would miss it.
  const voided = collectVoided(events, problems);

  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  let status: MatchState['status'] = 'SCHEDULED';
  let senshu: Side | null = null;
  let senshuLocked = false;
  let kiken: Side | null = null;
  let winner: MatchState['winner'];
  let decisionMethod: MatchState['decisionMethod'];

  const clock = { elapsedMs: 0, running: false, startedAtMs: null as number | null };
  const tallies: Record<Side, ScoreTally> = { AKA: emptyTally(), AO: emptyTally() };
  const penalties: { aka: PenaltyRecord[]; ao: PenaltyRecord[] } = { aka: [], ao: [] };
  const kataJudges: Record<string, Side> = {};
  const kataScores: Record<string, { aka: number; ao: number }> = {};
  let flags: { aka: number; ao: number } | undefined;
  const teamBouts: Array<{
    boutNo: number;
    winner: OutcomeSide;
    akaPoints: number;
    aoPoints: number;
    method: DecisionMethod;
  }> = [];


  for (const event of ordered) {
    if (voided.has(event.seq)) continue;

    switch (event.type) {
      case 'MATCH_CALLED':
        status = 'CALLED';
        break;

      case 'MATCH_READY':
        status = 'READY';
        break;

      case 'MATCH_START':
        status = 'LIVE';
        // Art. 5.3: the clock starts when the referee signals the bout to begin,
        // so starting the bout starts the clock. A separate command would let an
        // operator start a bout with no time running.
        if (!clock.running) {
          clock.running = true;
          clock.startedAtMs = event.ts;
        }
        break;

      case 'MATCH_END':
        status = 'FINISHED';
        // Stopping the bout stops the clock.
        if (clock.running && clock.startedAtMs !== null) {
          clock.elapsedMs += event.ts - clock.startedAtMs;
        }
        clock.running = false;
        clock.startedAtMs = null;
        break;

      case 'RESULT_CONFIRM':
        status = 'CONFIRMED';
        winner = { side: event.payload.winner, method: event.payload.method };
        decisionMethod = event.payload.method;
        break;

      case 'RESULT_VOID':
        // Correcting a result reopens the bout rather than deleting history.
        status = 'READY';
        winner = undefined;
        decisionMethod = undefined;
        break;

      case 'CLOCK_START':
      case 'CLOCK_RESUME':
        if (!clock.running) {
          clock.running = true;
          clock.startedAtMs = event.ts;
        }
        break;

      case 'CLOCK_STOP':
        if (clock.running && clock.startedAtMs !== null) {
          clock.elapsedMs += event.ts - clock.startedAtMs;
        }
        clock.running = false;
        clock.startedAtMs = null;
        break;

      case 'CLOCK_ADJUST':
        clock.elapsedMs = event.payload.elapsedMs;
        break;

      case 'SCORE': {
        const { side, value } = event.payload;
        const scoreType = scoreTypeForValue(context.ruleset, value);

        if (scoreType === null) {
          problems.push({
            code: 'SCORE_VALUE_NOT_IN_RULESET',
            seq: event.seq,
            message: `ruleset "${context.ruleset.id}" defines no score worth ${value}`,
          });
          break;
        }

        const tally = tallies[side];
        tally.points += value;
        if (scoreType === 'IPPON') tally.ippon += 1;
        if (scoreType === 'WAZA_ARI') tally.wazaAri += 1;
        if (scoreType === 'YUKO') tally.yuko += 1;
        break;
      }

      case 'PENALTY': {
        const { side, level, category } = event.payload;
        const bucket = side === 'AKA' ? penalties.aka : penalties.ao;
        bucket.push({ level, category, seq: event.seq, ts: event.ts });

        if (level === 'CHUI') {
          tallies[side].chui += 1;

          // Art. 10.2.1: CHUI may be given up to three times.
          if (tallies[side].chui > context.ruleset.penalties.chuiMax) {
            problems.push({
              code: 'EXCESSIVE_CHUI',
              seq: event.seq,
              message: `${side} has more than ${context.ruleset.penalties.chuiMax} CHUI, which HANSOKU CHUI should have replaced`,
            });
          }
        }
        break;
      }

      case 'SENSHU':
        // Art. 12.2.10: once it has been withdrawn late in the bout, neither
        // athlete can be awarded SENSHU again.
        if (!senshuLocked) {
          senshu = event.payload.side;
        }
        break;

      case 'SENSHU_TORIMASEN': {
        // Nothing to withdraw if the other side holds it.
        if (senshu !== event.payload.side) break;

        senshu = null;

        // Art. 12.2.10: withdrawing it inside the warning window locks the
        // advantage away for the rest of the bout, both athletes included.
        if (remainingMsAt(event, clock, context.durationSeconds) <= warningWindowMs(context.ruleset)) {
          senshuLocked = true;
        }
        break;
      }

      case 'KIKEN':
        kiken = event.payload.side;
        break;

      case 'KATA_JUDGE_VOTE': {
        kataJudges[String(event.payload.judgeNo)] = event.payload.side;
        if (event.payload.akaScore !== undefined && event.payload.aoScore !== undefined) {
          kataScores[String(event.payload.judgeNo)] = {
            aka: event.payload.akaScore,
            ao: event.payload.aoScore,
          };
        }
        let aka = 0;
        let ao = 0;
        for (const side of Object.values(kataJudges)) {
          if (side === 'AKA') aka += 1;
          else if (side === 'AO') ao += 1;
        }
        flags = { aka, ao };
        break;
      }

      case 'KATA_FLAGS': {
        flags = { aka: event.payload.akaFlags, ao: event.payload.aoFlags };
        break;
      }

      case 'TEAM_BOUT_RESULT': {
        const existingIdx = teamBouts.findIndex((b) => b.boutNo === event.payload.boutNo);
        const bout = {
          boutNo: event.payload.boutNo,
          winner: event.payload.winner,
          akaPoints: event.payload.akaPoints,
          aoPoints: event.payload.aoPoints,
          method: event.payload.method,
        };
        if (existingIdx >= 0) {
          teamBouts[existingIdx] = bout;
        } else {
          teamBouts.push(bout);
          teamBouts.sort((a, b) => a.boutNo - b.boutNo);
        }
        break;
      }

      // Bout-control annotations. They matter for the printed record and for
      // dispute review, but they do not change the score.
      case 'YAME':
      case 'TSUZUKETE':
      case 'WAKARETE':
      case 'MOTO_NO_ICHI':
      case 'DOCTOR_CALL':
      case 'INJURY_TIMEOUT_START':
      case 'INJURY_TIMEOUT_END':
      case 'EVENT_VOID':
      case 'VIDEO_REVIEW_REQUEST':
      case 'VIDEO_REVIEW_RESULT':
        break;

      default:
        break;
    }
  }

  const superior =
    Math.abs(tallies.AKA.points - tallies.AO.points) >= context.ruleset.superiorityMargin;

  const state: MatchState = {
    matchId: context.matchId,
    status,
    aka: context.aka,
    ao: context.ao,
    senshu,
    senshuLocked,
    kiken,
    clock,
    penalties,
    derived: { aka: tallies.AKA, ao: tallies.AO },
    superior,
    ...(winner === undefined ? {} : { winner }),
    ...(decisionMethod === undefined ? {} : { decisionMethod }),
    ...(Object.keys(kataJudges).length > 0 ? { kataJudges } : {}),
    ...(Object.keys(kataScores).length > 0 ? { kataScores } : {}),
    ...(flags !== undefined ? { flags } : {}),
    ...(teamBouts.length > 0 ? { teamBouts } : {}),
  };

  return { state, problems };
}

/** Elapsed time including any run still in progress, for live display. */
export function clockElapsedMs(state: MatchState, nowMs: number): number {
  if (!state.clock.running || state.clock.startedAtMs === null) {
    return state.clock.elapsedMs;
  }

  return state.clock.elapsedMs + Math.max(0, nowMs - state.clock.startedAtMs);
}

/** The window, in ms, inside which losing SENSHU makes it unrecoverable. */
function warningWindowMs(ruleset: MatchContext['ruleset']): number {
  return ruleset.timeWarningSeconds * 1_000;
}

/**
 * Time left on the clock at the moment an event happened.
 *
 * Needed because a rule can depend on *when* something was called rather than
 * on the score: SENSHU withdrawn inside the final warning window is gone for
 * good (Art. 12.2.10), while the same withdrawal earlier is not.
 */
function remainingMsAt(
  event: MatchEvent,
  clock: { elapsedMs: number; running: boolean; startedAtMs: number | null },
  durationSeconds: number,
): number {
  const elapsed =
    clock.elapsedMs +
    (clock.running && clock.startedAtMs !== null ? Math.max(0, event.ts - clock.startedAtMs) : 0);

  return durationSeconds * 1_000 - elapsed;
}

/** Time left on the clock, never below zero. */
export function clockRemainingMs(state: MatchState, durationSeconds: number, nowMs: number): number {
  return Math.max(0, durationSeconds * 1000 - clockElapsedMs(state, nowMs));
}

function collectVoided(events: readonly MatchEvent[], problems: ScoringProblem[]): Set<number> {
  const seqs = new Set(events.map((event) => event.seq));
  const voided = new Set<number>();

  for (const event of events) {
    if (event.type !== 'EVENT_VOID') continue;

    const target = event.payload.targetSeq;

    if (!seqs.has(target)) {
      problems.push({
        code: 'VOID_TARGET_NOT_FOUND',
        seq: event.seq,
        message: `EVENT_VOID names sequence ${target}, which is not in this log`,
      });
      continue;
    }

    voided.add(target);
  }

  return voided;
}
