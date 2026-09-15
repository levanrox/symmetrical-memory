import { matchEventSchema, type MatchEvent, type Side } from '@event-suite/protocol';
import { getRuleset, type Ruleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { proposeOutcome } from './decide';
import { nextPenaltyLevel, penaltiesTaken, penaltyLabel, penaltyProgress } from './penalties';
import { reduceMatch } from './reduce';
import type { MatchContext } from './types';

const ruleset = getRuleset('WKF_KUMITE_2026');

const uuid = (n: number): string => `0191f2a0-1234-7abc-8def-${String(n).padStart(12, '0')}`;
const MATCH_ID = uuid(1);
const BASE_TS = 1_762_000_000_000;

const context: MatchContext = {
  matchId: MATCH_ID,
  durationSeconds: 180,
  ruleset,
  aka: { registrationId: uuid(10), displayName: 'Rahul Kumar' },
  ao: { registrationId: uuid(11), displayName: 'Arjun Shetty' },
};

function ev(
  type: MatchEvent['type'],
  seq: number,
  payload: Record<string, unknown> = {},
): MatchEvent {
  return matchEventSchema.parse({
    matchId: MATCH_ID,
    seq,
    ts: BASE_TS + seq * 1_000,
    actor: 'admin@example.com',
    device: 'TATAMI-01',
    commandId: uuid(900 + seq),
    type,
    payload,
  });
}

/** Reduces a bout that starts, then takes `count` penalties on `side`. */
function afterPenalties(side: Side, count: number) {
  const events: MatchEvent[] = [ev('MATCH_START', 1)];

  for (let index = 0; index < count; index += 1) {
    events.push(
      ev('PENALTY', index + 2, {
        side,
        level: nextPenaltyLevel(
          // The server resolves each level against the state so far, exactly as
          // the real command handler does.
          reduceMatch(events, context).state,
          side,
          ruleset,
        ),
      }),
    );
  }

  return {
    events,
    state: reduceMatch(events, context).state,
  };
}

describe('penalty ladder — WKF Art. 10.2-10.3', () => {
  it('gives three CHUI, then HANSOKU CHUI, then HANSOKU', () => {
    const expected = ['CHUI', 'CHUI', 'CHUI', 'HANSOKU_CHUI', 'HANSOKU'];

    let state = reduceMatch([ev('MATCH_START', 1)], context).state;

    expected.forEach((level, index) => {
      expect(nextPenaltyLevel(state, 'AKA', ruleset), `penalty ${index + 1}`).toBe(level);
      state = reduceMatch(afterPenalties('AKA', index + 1).events, context).state;
    });
  });

  it('reports how far up the ladder an athlete is', () => {
    // The ladder is [CHUI, CHUI, CHUI, HANSOKU CHUI, HANSOKU], so the fourth
    // tap is already the warning before disqualification.
    const expectedNext = ['CHUI', 'CHUI', 'CHUI', 'HANSOKU_CHUI', 'HANSOKU'];

    for (let count = 0; count <= 4; count += 1) {
      const { state } = afterPenalties('AKA', count);
      const progress = penaltyProgress(state, 'AKA', ruleset);

      expect(progress.taken, `${count} penalties taken`).toBe(count);
      expect(progress.next, `after ${count}`).toBe(expectedNext[count]);
    }
  });

  it('counts the rungs, not the raw penalty events', () => {
    const { state } = afterPenalties('AKA', 4);

    expect(penaltiesTaken(state, 'AKA')).toBe(4);
    expect(penaltyProgress(state, 'AKA', ruleset).next).toBe('HANSOKU');
  });

  it('keeps one ladder per athlete, so a penalised AKA says nothing about AO', () => {
    const { state } = afterPenalties('AKA', 3);

    expect(penaltyProgress(state, 'AKA', ruleset).next).toBe('HANSOKU_CHUI');
    // AO has done nothing.
    expect(penaltyProgress(state, 'AO', ruleset).taken).toBe(0);
    expect(penaltyProgress(state, 'AO', ruleset).next).toBe('CHUI');
  });

  it('does not end the bout on HANSOKU CHUI — that is still a warning', () => {
    const { state } = afterPenalties('AKA', 4);

    // The fourth penalty was HANSOKU CHUI, and the bout is still running.
    expect(state.penalties.aka.map((penalty) => penalty.level)).toEqual([
      'CHUI',
      'CHUI',
      'CHUI',
      'HANSOKU_CHUI',
    ]);
    expect(state.penalties.aka.some((penalty) => penalty.level === 'HANSOKU')).toBe(false);

    // Nobody has won yet: HANSOKU CHUI is a warning, not a disqualification.
    expect(state.status).toBe('LIVE');
    expect(proposeOutcome(state, ruleset)).not.toMatchObject({ method: 'HANSOKU' });

    // The next penalty is the one that ends it.
    expect(penaltyProgress(state, 'AKA', ruleset).endsBout).toBe(true);
  });

  it('starts from CHUI before any penalty has been given', () => {
    expect(nextPenaltyLevel(null, 'AKA', ruleset)).toBe('CHUI');
  });

  it('does not run past the end of the ladder', () => {
    const { state } = afterPenalties('AO', 8);

    expect(penaltyProgress(state, 'AO', ruleset).next).toBe('HANSOKU');
  });

  it('names the rungs the way the score sheet writes them', () => {
    expect(penaltyLabel('CHUI', 1)).toBe('CHUI 1');
    expect(penaltyLabel('CHUI', 3)).toBe('CHUI 3');
    expect(penaltyLabel('HANSOKU_CHUI', 4)).toBe('HANSOKU CHUI');
    expect(penaltyLabel('HANSOKU', 5)).toBe('HANSOKU');
  });

  it('hands the bout to the opponent once HANSOKU lands', () => {
    const { state } = afterPenalties('AKA', 5);

    expect(proposeOutcome(state, ruleset)).toMatchObject({
      kind: 'DECIDED',
      side: 'AO',
      method: 'HANSOKU',
    });
  });

  it('records only the levels the ruleset allows', () => {
    const { state } = afterPenalties('AKA', 5);
    const levels = state.penalties.aka.map((penalty) => penalty.level);

    expect(levels).toEqual(['CHUI', 'CHUI', 'CHUI', 'HANSOKU_CHUI', 'HANSOKU']);
    // The old code allowed an unbounded run of CHUI; this is the assertion that
    // would have caught it.
    expect(state.derived.aka.chui).toBe(3);
  });

  it('follows the ruleset rather than a hardcoded sequence', () => {
    // A federation that ordered the ladder differently changes data, not code.
    const shorter: Ruleset = {
      ...ruleset,
      penalties: { ...ruleset.penalties, chuiMax: 1, escalation: ['CHUI', 'HANSOKU'] },
    };

    const events = [ev('MATCH_START', 1), ev('PENALTY', 2, { side: 'AKA', level: 'CHUI' })];
    const state = reduceMatch(events, { ...context, ruleset: shorter }).state;

    expect(nextPenaltyLevel(state, 'AKA', shorter)).toBe('HANSOKU');
  });
});
