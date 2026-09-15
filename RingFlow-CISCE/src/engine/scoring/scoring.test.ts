import { matchEventSchema, type MatchEvent, type MatchState } from '@event-suite/protocol';
import { createDerivedRuleset, getRuleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { proposeOutcome } from './decide';
import { clockElapsedMs, clockRemainingMs, reduceMatch } from './reduce';
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

/**
 * Builds a match event and parses it through the wire schema, so a fixture can
 * never drift from the contract the server actually accepts.
 */
function ev(
  type: MatchEvent['type'],
  seq: number,
  payload: Record<string, unknown> = {},
  ts: number = BASE_TS + seq * 1_000,
): MatchEvent {
  return matchEventSchema.parse({
    matchId: MATCH_ID,
    seq,
    ts,
    actor: 'admin@example.com',
    device: 'TATAMI-01',
    commandId: uuid(900 + seq),
    type,
    payload,
  });
}

function stateOf(events: readonly MatchEvent[]): MatchState {
  return reduceMatch(events, context).state;
}

const score = (side: 'AKA' | 'AO', value: 1 | 2 | 3) => ({ side, value, target: 'JODAN', technique: 'KERI' });

describe('reduceMatch — lifecycle', () => {
  it('starts scheduled with nothing scored', () => {
    const state = stateOf([]);

    expect(state.status).toBe('SCHEDULED');
    expect(state.derived.aka.points).toBe(0);
    expect(state.derived.ao.points).toBe(0);
    expect(state.senshu).toBeNull();
    expect(state.kiken).toBeNull();
    expect(state.winner).toBeUndefined();
    expect(state.superior).toBe(false);
  });

  it('walks the bout through to a confirmed result', () => {
    const events = [
      ev('MATCH_CALLED', 1),
      ev('MATCH_READY', 2),
      ev('MATCH_START', 3),
      ev('MATCH_END', 4),
      ev('RESULT_CONFIRM', 5, { winner: 'AKA', method: 'POINTS' }),
    ];

    const state = stateOf(events);

    expect(state.status).toBe('CONFIRMED');
    expect(state.winner).toEqual({ side: 'AKA', method: 'POINTS' });
    expect(state.decisionMethod).toBe('POINTS');
  });

  it('reopens the bout when a result is voided', () => {
    const events = [
      ev('MATCH_START', 1),
      ev('MATCH_END', 2),
      ev('RESULT_CONFIRM', 3, { winner: 'AKA', method: 'POINTS' }),
      ev('RESULT_VOID', 4, { reason: 'wrong athlete recorded' }),
    ];

    const state = stateOf(events);

    expect(state.status).toBe('READY');
    expect(state.winner).toBeUndefined();
  });

  it('applies events in sequence order regardless of array order', () => {
    const shuffled = [
      ev('RESULT_CONFIRM', 3, { winner: 'AO', method: 'POINTS' }),
      ev('MATCH_END', 2),
      ev('MATCH_START', 1),
    ];

    expect(stateOf(shuffled).status).toBe('CONFIRMED');
    expect(stateOf(shuffled).winner?.side).toBe('AO');
  });
});

describe('reduceMatch — scoring', () => {
  it('accumulates score types and points', () => {
    const state = stateOf([
      ev('SCORE', 1, score('AKA', 3)), // IPPON
      ev('SCORE', 2, score('AKA', 1)), // YUKO
      ev('SCORE', 3, score('AO', 2)), // WAZA ARI
    ]);

    expect(state.derived.aka).toEqual({ points: 4, ippon: 1, wazaAri: 0, yuko: 1, chui: 0 });
    expect(state.derived.ao).toEqual({ points: 2, ippon: 0, wazaAri: 1, yuko: 0, chui: 0 });
  });

  it('flags superiority once the lead reaches the ruleset margin (Art. 7.7)', () => {
    const events = [1, 2, 3].map((seq) => ev('SCORE', seq, score('AKA', 3)));
    const state = stateOf(events);

    expect(state.derived.aka.points).toBe(9);
    expect(state.superior).toBe(true);
  });

  it('does not flag superiority below the margin', () => {
    const state = stateOf([ev('SCORE', 1, score('AKA', 3)), ev('SCORE', 2, score('AO', 3))]);

    expect(state.derived.aka.points).toBe(3);
    expect(state.derived.ao.points).toBe(3);
    expect(state.superior).toBe(false);
  });

  it('reports a score value the ruleset does not define', () => {
    // A ruleset whose values start at 2 leaves value 1 unmappable.
    const unusual = createDerivedRuleset(ruleset, {
      id: 'ODD_VALUES',
      version: '1.0',
      scoring: { YUKO: 2, WAZA_ARI: 3, IPPON: 4 },
    });

    const result = reduceMatch([ev('SCORE', 1, score('AKA', 1))], {
      ...context,
      ruleset: unusual,
    });

    expect(result.problems.map((problem) => problem.code)).toContain('SCORE_VALUE_NOT_IN_RULESET');
  });
});

describe('reduceMatch — clock', () => {
  it('starts the clock when the bout starts (Art. 5.3)', () => {
    const state = stateOf([ev('MATCH_START', 1, {}, BASE_TS)]);

    expect(state.status).toBe('LIVE');
    expect(state.clock.running).toBe(true);
    expect(state.clock.startedAtMs).toBe(BASE_TS);
  });

  it('stops and accumulates the clock when the bout ends', () => {
    const state = stateOf([
      ev('MATCH_START', 1, {}, BASE_TS),
      ev('MATCH_END', 2, {}, BASE_TS + 95_000),
    ]);

    expect(state.status).toBe('FINISHED');
    expect(state.clock.running).toBe(false);
    expect(state.clock.elapsedMs).toBe(95_000);
  });

  it('accumulates elapsed time across pauses', () => {
    const events = [
      ev('CLOCK_START', 1, {}, BASE_TS),
      ev('CLOCK_STOP', 2, {}, BASE_TS + 10_000),
      ev('CLOCK_RESUME', 3, {}, BASE_TS + 20_000),
      ev('CLOCK_STOP', 4, {}, BASE_TS + 25_000),
    ];

    const state = stateOf(events);

    expect(state.clock.elapsedMs).toBe(15_000);
    expect(state.clock.running).toBe(false);
    expect(state.clock.startedAtMs).toBeNull();
  });

  it('ignores a repeated start while already running', () => {
    const state = stateOf([ev('CLOCK_START', 1, {}, BASE_TS), ev('CLOCK_START', 2, {}, BASE_TS + 5_000)]);

    expect(state.clock.running).toBe(true);
    expect(state.clock.startedAtMs).toBe(BASE_TS);
  });

  it('accepts an audited clock correction (Art. 7.11)', () => {
    const state = stateOf([
      ev('CLOCK_START', 1, {}, BASE_TS),
      ev('CLOCK_STOP', 2, {}, BASE_TS + 10_000),
      ev('CLOCK_ADJUST', 3, { elapsedMs: 45_000, reason: 'timekeeper error' }),
    ]);

    expect(state.clock.elapsedMs).toBe(45_000);
  });

  it('projects a running clock for live display without mutating state', () => {
    const state = stateOf([ev('CLOCK_START', 1, {}, BASE_TS)]);

    expect(clockElapsedMs(state, BASE_TS + 7_000)).toBe(7_000);
    expect(clockElapsedMs(state, BASE_TS)).toBe(0);
    // The stored state is untouched by projecting.
    expect(state.clock.elapsedMs).toBe(0);
  });

  it('counts down to the bout duration and never below zero', () => {
    const state = stateOf([ev('CLOCK_START', 1, {}, BASE_TS)]);

    expect(clockRemainingMs(state, 180, BASE_TS)).toBe(180_000);
    expect(clockRemainingMs(state, 180, BASE_TS + 179_000)).toBe(1_000);
    expect(clockRemainingMs(state, 180, BASE_TS + 500_000)).toBe(0);
  });
});

describe('reduceMatch — penalties and advantages', () => {
  it('records penalties with their sequence and timestamp', () => {
    const state = stateOf([
      ev('PENALTY', 1, { side: 'AKA', level: 'CHUI', category: 1 }, BASE_TS + 1_000),
      ev('PENALTY', 2, { side: 'AKA', level: 'HANSOKU_CHUI', category: 2 }, BASE_TS + 2_000),
    ]);

    expect(state.penalties.aka).toHaveLength(2);
    expect(state.penalties.aka[0]).toEqual({
      level: 'CHUI',
      category: 1,
      seq: 1,
      ts: BASE_TS + 1_000,
    });
    expect(state.derived.aka.chui).toBe(1);
  });

  it('flags a fourth CHUI, which the rules replace with HANSOKU CHUI (Art. 10.2.1)', () => {
    const result = reduceMatch(
      [1, 2, 3, 4].map((seq) => ev('PENALTY', seq, { side: 'AKA', level: 'CHUI', category: 2 })),
      context,
    );

    expect(result.problems.map((problem) => problem.code)).toContain('EXCESSIVE_CHUI');
  });

  it('tracks SENSHU and its annulment (Art. 12.2.8)', () => {
    expect(stateOf([ev('SENSHU', 1, { side: 'AKA' })]).senshu).toBe('AKA');
    expect(
      stateOf([ev('SENSHU', 1, { side: 'AKA' }), ev('SENSHU_TORIMASEN', 2, { side: 'AKA' })]).senshu,
    ).toBeNull();
  });

  it('ignores an annulment aimed at the other side', () => {
    const state = stateOf([ev('SENSHU', 1, { side: 'AKA' }), ev('SENSHU_TORIMASEN', 2, { side: 'AO' })]);

    expect(state.senshu).toBe('AKA');
  });

  it('allows SENSHU to be awarded again when it is withdrawn early in the bout', () => {
    const state = stateOf([
      ev('MATCH_START', 1, {}, BASE_TS),
      ev('CLOCK_STOP', 2, {}, BASE_TS + 30_000),
      ev('SENSHU', 3, { side: 'AKA' }),
      ev('SENSHU_TORIMASEN', 4, { side: 'AKA' }),
      ev('SENSHU', 5, { side: 'AO' }),
    ]);

    expect(state.senshuLocked).toBe(false);
    expect(state.senshu).toBe('AO');
  });

  it('locks SENSHU away for both athletes once withdrawn inside the warning window (Art. 12.2.10)', () => {
    // 170 of 180 seconds gone, so 10 remain: inside the 15-second window.
    const state = stateOf([
      ev('MATCH_START', 1, {}, BASE_TS),
      ev('CLOCK_STOP', 2, {}, BASE_TS + 170_000),
      ev('SENSHU', 3, { side: 'AKA' }),
      ev('SENSHU_TORIMASEN', 4, { side: 'AKA' }),
      ev('SENSHU', 5, { side: 'AO' }),
    ]);

    expect(state.senshuLocked).toBe(true);
    // The later award does nothing — not to AKA, not to AO.
    expect(state.senshu).toBeNull();
  });

  it('locks SENSHU when the withdrawal happens exactly at the warning boundary', () => {
    // 165 seconds gone, exactly 15 remaining.
    const state = stateOf([
      ev('MATCH_START', 1, {}, BASE_TS),
      ev('CLOCK_STOP', 2, {}, BASE_TS + 165_000),
      ev('SENSHU', 3, { side: 'AKA' }),
      ev('SENSHU_TORIMASEN', 4, { side: 'AKA' }),
    ]);

    expect(state.senshuLocked).toBe(true);
  });

  it('leaves an unheld SENSHU untouched and unlocked', () => {
    // Withdrawing from the side that does not hold it is a no-op.
    const state = stateOf([
      ev('MATCH_START', 1, {}, BASE_TS),
      ev('CLOCK_STOP', 2, {}, BASE_TS + 170_000),
      ev('SENSHU_TORIMASEN', 3, { side: 'AO' }),
      ev('SENSHU', 4, { side: 'AKA' }),
    ]);

    expect(state.senshuLocked).toBe(false);
    expect(state.senshu).toBe('AKA');
  });

  it('records KIKEN against the absent side (Art. 6)', () => {
    expect(stateOf([ev('KIKEN', 1, { side: 'AO' })]).kiken).toBe('AO');
  });
});

describe('reduceMatch — undo by voiding', () => {
  it('removes the effect of a voided score', () => {
    const events = [
      ev('SCORE', 1, score('AKA', 3)),
      ev('SCORE', 2, score('AKA', 1)),
      ev('EVENT_VOID', 3, { targetSeq: 2, reason: 'accidental double tap' }),
    ];

    const state = stateOf(events);

    expect(state.derived.aka.points).toBe(3);
    expect(state.derived.aka.yuko).toBe(0);
    expect(state.derived.aka.ippon).toBe(1);
  });

  it('voids an event that appears later in the array than the void itself', () => {
    const events = [
      ev('EVENT_VOID', 5, { targetSeq: 9, reason: 'out of order arrival' }),
      ev('SCORE', 9, score('AKA', 3)),
    ];

    expect(stateOf(events).derived.aka.points).toBe(0);
  });

  it('reports a void that names a sequence which is not in the log', () => {
    const result = reduceMatch([ev('EVENT_VOID', 1, { targetSeq: 42, reason: 'typo' })], context);

    expect(result.problems.map((problem) => problem.code)).toContain('VOID_TARGET_NOT_FOUND');
  });

  it('does not void the voiding event itself', () => {
    const state = stateOf([
      ev('SCORE', 1, score('AKA', 3)),
      ev('EVENT_VOID', 2, { targetSeq: 1, reason: 'mistake' }),
    ]);

    expect(state.derived.aka.points).toBe(0);
  });
});

describe('reduceMatch — purity', () => {
  it('returns the same state for the same log', () => {
    const events = [ev('MATCH_START', 1), ev('SCORE', 2, score('AKA', 2))];

    expect(stateOf(events)).toEqual(stateOf(events));
  });

  it('does not mutate the input array', () => {
    const events = [ev('MATCH_START', 2), ev('MATCH_START', 1)];
    const before = events.map((event) => event.seq);

    reduceMatch(events, context);

    expect(events.map((event) => event.seq)).toEqual(before);
  });
});

describe('proposeOutcome — Art. 12.2 in order', () => {
  it('awards the bout on points when the scores differ', () => {
    const state = stateOf([ev('SCORE', 1, score('AKA', 3)), ev('SCORE', 2, score('AO', 1))]);

    expect(proposeOutcome(state, ruleset)).toEqual({
      kind: 'DECIDED',
      side: 'AKA',
      method: 'POINTS',
      reason: '3-1 on points',
    });
  });

  it('falls back to SENSHU when the points are level', () => {
    const state = stateOf([
      ev('SCORE', 1, score('AKA', 1)),
      ev('SCORE', 2, score('AO', 1)),
      ev('SENSHU', 3, { side: 'AO' }),
    ]);

    const outcome = proposeOutcome(state, ruleset);
    expect(outcome.kind).toBe('DECIDED');
    expect(outcome).toMatchObject({ side: 'AO', method: 'SENSHU' });
  });

  it('falls back to the IPPON count when points and SENSHU are level', () => {
    // AKA: one IPPON. AO: three YUKO. Level on points, AKA ahead on IPPON.
    const state = stateOf([
      ev('SCORE', 1, score('AKA', 3)),
      ev('SCORE', 2, score('AO', 1)),
      ev('SCORE', 3, score('AO', 1)),
      ev('SCORE', 4, score('AO', 1)),
    ]);

    const outcome = proposeOutcome(state, ruleset);
    expect(outcome.kind).toBe('DECIDED');
    expect(outcome).toMatchObject({ side: 'AKA' });
    expect(outcome.kind === 'DECIDED' && outcome.reason).toContain('IPPON');
  });

  it('falls back to the WAZA ARI count when IPPON counts are level', () => {
    // AKA: WAZA ARI + YUKO = 3. AO: three YUKO = 3. Level points and IPPON; AKA
    // ahead on WAZA ARI.
    const state = stateOf([
      ev('SCORE', 1, score('AKA', 2)),
      ev('SCORE', 2, score('AKA', 1)),
      ev('SCORE', 3, score('AO', 1)),
      ev('SCORE', 4, score('AO', 1)),
      ev('SCORE', 5, score('AO', 1)),
    ]);

    const outcome = proposeOutcome(state, ruleset);
    expect(outcome.kind).toBe('DECIDED');
    expect(outcome).toMatchObject({ side: 'AKA' });
    expect(outcome.kind === 'DECIDED' && outcome.reason).toContain('WAZA ARI');
  });

  it('asks for HANTEI when nothing separates the athletes (Art. 12.2.4)', () => {
    const state = stateOf([ev('SCORE', 1, score('AKA', 1)), ev('SCORE', 2, score('AO', 1))]);

    expect(proposeOutcome(state, ruleset).kind).toBe('HANTEI_REQUIRED');
  });

  it('returns a draw instead of HANTEI where a draw is permitted (Art. 12.2.5)', () => {
    const state = stateOf([ev('SCORE', 1, score('AKA', 1)), ev('SCORE', 2, score('AO', 1))]);

    expect(proposeOutcome(state, ruleset, { hikiwakeAllowed: true }).kind).toBe('HIKIWAKE');
  });

  it('awards the bout to the opponent of an absent athlete (Art. 6)', () => {
    const state = stateOf([ev('KIKEN', 1, { side: 'AKA' })]);

    expect(proposeOutcome(state, ruleset)).toMatchObject({
      kind: 'DECIDED',
      side: 'AO',
      method: 'KIKEN',
    });
  });

  it('lets HANSOKU override a winning score (Art. 10.3)', () => {
    const state = stateOf([
      ev('SCORE', 1, score('AKA', 3)),
      ev('PENALTY', 2, { side: 'AKA', level: 'HANSOKU', category: 1 }),
    ]);

    expect(proposeOutcome(state, ruleset)).toMatchObject({
      kind: 'DECIDED',
      side: 'AO',
      method: 'HANSOKU',
    });
  });

  it('lets SHIKKAKU take precedence over HANSOKU', () => {
    const state = stateOf([
      ev('PENALTY', 1, { side: 'AKA', level: 'HANSOKU', category: 1 }),
      ev('PENALTY', 2, { side: 'AO', level: 'SHIKKAKU', category: 2 }),
    ]);

    // AKA is out of the bout, AO is out of the tournament; AO's disqualification
    // is the more severe, so AKA takes it.
    expect(proposeOutcome(state, ruleset)).toMatchObject({
      kind: 'DECIDED',
      side: 'AKA',
      method: 'SHIKKAKU',
    });
  });

  it('ignores a voided penalty when proposing an outcome', () => {
    const state = stateOf([
      ev('SCORE', 1, score('AKA', 3)),
      ev('PENALTY', 2, { side: 'AKA', level: 'HANSOKU', category: 1 }),
      ev('EVENT_VOID', 3, { targetSeq: 2, reason: 'referee reversed the call' }),
    ]);

    expect(proposeOutcome(state, ruleset)).toMatchObject({
      kind: 'DECIDED',
      side: 'AKA',
      method: 'POINTS',
    });
  });
});
