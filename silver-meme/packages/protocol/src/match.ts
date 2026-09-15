import { z } from 'zod';
import { MATCH_STATES } from '@event-suite/domain';
import {
  DECISION_METHODS,
  PENALTY_LEVELS,
  SIDES,
  TARGETS,
  TECHNIQUES,
  type Side,
} from '@event-suite/rules-engine';

/**
 * The scoring contract (blueprint §7).
 *
 * These types live in `protocol` rather than in a scoring package because they
 * are genuinely shared wire shapes: the server appends and broadcasts them, and
 * every client — scorer console, scoreboard, announcer, admin monitor — reads
 * the same definitions. The scoring package implements behaviour *against*
 * these types; it does not own them.
 */

/** Score values a scorer can award (Art. 8.6). */
export const scoreValueSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type ScoreValue = z.infer<typeof scoreValueSchema>;

export const sideSchema = z.enum(SIDES);
export const targetSchema = z.enum(TARGETS);
export const techniqueSchema = z.enum(TECHNIQUES);
export const penaltyLevelSchema = z.enum(PENALTY_LEVELS);
export const decisionMethodSchema = z.enum(DECISION_METHODS);

/** A winning side, or HIKIWAKE where the ruleset permits a draw (Art. 12.2.5). */
export const outcomeSideSchema = z.union([sideSchema, z.literal('HIKIWAKE')]);
export type OutcomeSide = z.infer<typeof outcomeSideSchema>;

export const MATCH_EVENT_TYPES = [
  // lifecycle
  'MATCH_CALLED',
  'MATCH_READY',
  'MATCH_START',
  'MATCH_END',
  'RESULT_CONFIRM',
  'RESULT_VOID',
  'EVENT_VOID',
  // clock
  'CLOCK_START',
  'CLOCK_STOP',
  'CLOCK_RESUME',
  'CLOCK_ADJUST',
  // scoring
  'SCORE',
  // penalties and advantages
  'PENALTY',
  'SENSHU',
  'SENSHU_TORIMASEN',
  'KIKEN',
  // bout control
  'YAME',
  'TSUZUKETE',
  'WAKARETE',
  'MOTO_NO_ICHI',
  // medical and video review
  'DOCTOR_CALL',
  'INJURY_TIMEOUT_START',
  'INJURY_TIMEOUT_END',
  'VIDEO_REVIEW_REQUEST',
  'VIDEO_REVIEW_RESULT',
  // kata and team kumite
  'KATA_JUDGE_VOTE',
  'KATA_FLAGS',
  'TEAM_BOUT_RESULT',
] as const;

export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

/**
 * Event types that carry no data beyond their identity.
 *
 * Derived with `Extract` rather than from a runtime array so it is checked
 * against {@link MatchEventType} at compile time: a name that is not a real
 * event type collapses the union and the `bareEvent` calls below stop compiling.
 */
type BareEventType = Extract<
  MatchEventType,
  | 'MATCH_CALLED'
  | 'MATCH_READY'
  | 'MATCH_START'
  | 'MATCH_END'
  | 'CLOCK_START'
  | 'CLOCK_STOP'
  | 'CLOCK_RESUME'
  | 'YAME'
  | 'TSUZUKETE'
  | 'WAKARETE'
  | 'MOTO_NO_ICHI'
  | 'DOCTOR_CALL'
  | 'INJURY_TIMEOUT_START'
  | 'INJURY_TIMEOUT_END'
>;

const emptyPayload = z.strictObject({});

/**
 * Match identifiers are deterministic strings derived from the category and the
 * match number — `<categoryId>:M7` — not UUIDs.
 *
 * That is deliberate: it is what makes a regenerated draw comparable to the one
 * it replaced, and it lets a printed sheet be checked against the live bracket.
 * A random id would make both impossible, so this is a plain non-empty string.
 */
export const matchIdSchema = z.string().min(1);

/** Every match event carries the same envelope fields. */
const matchEventBase = {
  matchId: matchIdSchema,
  /** Monotonic per match, unique with matchId. The ordering key of the log. */
  seq: z.int().nonnegative(),
  ts: z.int().nonnegative(),
  /**
   * Who acted, as an operator identity (an email). Deliberately a label rather
   * than a foreign key: the log has to stay readable after an account is gone.
   */
  actor: z.string().min(1),
  /** Which device it came from, as a label such as `TATAMI-01`. */
  device: z.string().min(1),
  /** Client-supplied, so a retried command cannot apply twice. */
  commandId: z.uuid(),
};

function bareEvent<T extends BareEventType>(type: T) {
  return z.strictObject({ ...matchEventBase, type: z.literal(type), payload: emptyPayload });
}

export const matchEventSchema = z.discriminatedUnion('type', [
  bareEvent('MATCH_CALLED'),
  bareEvent('MATCH_READY'),
  bareEvent('MATCH_START'),
  bareEvent('MATCH_END'),
  bareEvent('CLOCK_START'),
  bareEvent('CLOCK_STOP'),
  bareEvent('CLOCK_RESUME'),
  bareEvent('YAME'),
  bareEvent('TSUZUKETE'),
  bareEvent('WAKARETE'),
  bareEvent('MOTO_NO_ICHI'),
  bareEvent('DOCTOR_CALL'),
  bareEvent('INJURY_TIMEOUT_START'),
  bareEvent('INJURY_TIMEOUT_END'),

  // Art. 7.6 — the referee identifies side, area and technique before the value.
  z.strictObject({
    ...matchEventBase,
    type: z.literal('SCORE'),
    payload: z.strictObject({
      side: sideSchema,
      value: scoreValueSchema,
      target: targetSchema,
      technique: techniqueSchema,
    }),
  }),

  // Art. 10 — the level is derived from the athlete's ladder, not chosen by the
  // operator. The sheet records it as 1C / 2C / 3C / HC / H.
  z.strictObject({
    ...matchEventBase,
    type: z.literal('PENALTY'),
    payload: z.strictObject({
      side: sideSchema,
      level: penaltyLevelSchema,
      /**
       * Which family of offence it was, where a federation wants it recorded.
       * WKF does not use it to escalate: the ladder is one per athlete.
       */
      category: z.union([z.literal(1), z.literal(2)]).optional(),
    }),
  }),

  // Art. 12.2.2 — first unopposed score advantage, and its annulment (12.2.8).
  z.strictObject({
    ...matchEventBase,
    type: z.literal('SENSHU'),
    payload: z.strictObject({ side: sideSchema }),
  }),
  z.strictObject({
    ...matchEventBase,
    type: z.literal('SENSHU_TORIMASEN'),
    payload: z.strictObject({ side: sideSchema }),
  }),

  // Art. 6 — failure to appear.
  z.strictObject({
    ...matchEventBase,
    type: z.literal('KIKEN'),
    payload: z.strictObject({ side: sideSchema }),
  }),

  // Art. 14.3 — a coach requests review for a specific score level.
  z.strictObject({
    ...matchEventBase,
    type: z.literal('VIDEO_REVIEW_REQUEST'),
    payload: z.strictObject({
      side: sideSchema,
      requestedValue: scoreValueSchema,
    }),
  }),

  // Art. 14.12 and 14.14 — the outcome, and whether the coach keeps their card.
  z.strictObject({
    ...matchEventBase,
    type: z.literal('VIDEO_REVIEW_RESULT'),
    payload: z.strictObject({
      side: sideSchema,
      outcome: z.enum(['AWARDED', 'NOT_AWARDED', 'MIENAI']),
      /** Present only when the request was upheld. */
      value: scoreValueSchema.optional(),
      cardReturned: z.boolean(),
    }),
  }),

  // Art. 5.5 / 7.11 — recording or correcting elapsed time.
  z.strictObject({
    ...matchEventBase,
    type: z.literal('CLOCK_ADJUST'),
    payload: z.strictObject({ elapsedMs: z.int().nonnegative(), reason: z.string().min(1) }),
  }),

  z.strictObject({
    ...matchEventBase,
    type: z.literal('RESULT_CONFIRM'),
    payload: z.strictObject({
      winner: outcomeSideSchema,
      method: decisionMethodSchema,
    }),
  }),

  z.strictObject({
    ...matchEventBase,
    type: z.literal('RESULT_VOID'),
    payload: z.strictObject({ reason: z.string().min(1) }),
  }),

  // The undo primitive: voids an earlier event rather than deleting it (§7.2).
  z.strictObject({
    ...matchEventBase,
    type: z.literal('EVENT_VOID'),
    payload: z.strictObject({ targetSeq: z.int().nonnegative(), reason: z.string().min(1) }),
  }),

  // Kata judge vote (from mobile QR code or ring console)
  z.strictObject({
    ...matchEventBase,
    type: z.literal('KATA_JUDGE_VOTE'),
    payload: z.strictObject({
      judgeNo: z.int().min(1).max(7),
      side: sideSchema,
      akaScore: z.number().min(0).max(10).optional(),
      aoScore: z.number().min(0).max(10).optional(),
    }),
  }),

  // Kata flags summary / manual override
  z.strictObject({
    ...matchEventBase,
    type: z.literal('KATA_FLAGS'),
    payload: z.strictObject({
      akaFlags: z.int().nonnegative(),
      aoFlags: z.int().nonnegative(),
      totalJudges: z.int().positive().optional(),
    }),
  }),

  // Team kumite individual bout result
  z.strictObject({
    ...matchEventBase,
    type: z.literal('TEAM_BOUT_RESULT'),
    payload: z.strictObject({
      boutNo: z.int().positive(),
      winner: outcomeSideSchema,
      akaPoints: z.int().nonnegative(),
      aoPoints: z.int().nonnegative(),
      method: decisionMethodSchema,
    }),
  }),
]);

export type MatchEvent = z.infer<typeof matchEventSchema>;

/** Clock state, always owned by the server (blueprint §7.3). */
export const clockStateSchema = z.strictObject({
  elapsedMs: z.int().nonnegative(),
  running: z.boolean(),
  /** Server reference for the current run, or null while stopped. */
  startedAtMs: z.int().nonnegative().nullable(),
});
export type ClockState = z.infer<typeof clockStateSchema>;

/** A single recorded penalty, kept for the result sheet (Art. 12.6). */
export const penaltyRecordSchema = z.strictObject({
  level: penaltyLevelSchema,
  /** The offence family, where a federation records it. WKF does not escalate by it. */
  category: z.union([z.literal(1), z.literal(2)]).optional(),
  seq: z.int().nonnegative(),
  ts: z.int().nonnegative(),
});
export type PenaltyRecord = z.infer<typeof penaltyRecordSchema>;

/** Tallies derived from the event log, never stored as truth. */
export const scoreTallySchema = z.strictObject({
  points: z.int().nonnegative(),
  ippon: z.int().nonnegative(),
  wazaAri: z.int().nonnegative(),
  yuko: z.int().nonnegative(),
  chui: z.int().nonnegative(),
});
export type ScoreTally = z.infer<typeof scoreTallySchema>;

/** Who is on each side of the match. */
export const athleteScoreSchema = z.strictObject({
  registrationId: z.uuid().nullable(),
  displayName: z.string(),
});
export type AthleteScore = z.infer<typeof athleteScoreSchema>;

export const matchWinnerSchema = z.strictObject({
  side: outcomeSideSchema,
  method: decisionMethodSchema,
});

export const matchStateSchema = z.strictObject({
  matchId: matchIdSchema,
  status: z.enum(MATCH_STATES),
  aka: athleteScoreSchema,
  ao: athleteScoreSchema,
  senshu: sideSchema.nullable(),
  /**
   * True once SENSHU has been withdrawn inside the final warning window, after
   * which neither athlete can be awarded it (Art. 12.2.10).
   */
  senshuLocked: z.boolean(),
  /** Side that failed to appear (Art. 6), if any. */
  kiken: sideSchema.nullable(),
  clock: clockStateSchema,
  penalties: z.strictObject({
    aka: z.array(penaltyRecordSchema),
    ao: z.array(penaltyRecordSchema),
  }),
  winner: matchWinnerSchema.optional(),
  decisionMethod: decisionMethodSchema.optional(),
  derived: z.strictObject({ aka: scoreTallySchema, ao: scoreTallySchema }),
  /** True once the lead reaches the ruleset's superiority margin (Art. 7.7). */
  superior: z.boolean(),
  /** Judge flag votes in Kata (e.g. { "1": "AKA", "2": "AO" }) */
  kataJudges: z.record(z.string(), sideSchema).optional(),
  /** Numeric scores (5.0-10.0) from judges in Kata */
  kataScores: z
    .record(
      z.string(),
      z.strictObject({
        aka: z.number().min(0).max(10),
        ao: z.number().min(0).max(10),
      }),
    )
    .optional(),
  /** Total flags for AKA and AO in Kata */
  flags: z.strictObject({ aka: z.int().nonnegative(), ao: z.int().nonnegative() }).optional(),
  /** Completed individual bouts in a Team Kumite match */
  teamBouts: z
    .array(
      z.strictObject({
        boutNo: z.int().positive(),
        winner: outcomeSideSchema,
        akaPoints: z.int().nonnegative(),
        aoPoints: z.int().nonnegative(),
        method: decisionMethodSchema,
      }),
    )
    .optional(),
});


export type MatchState = z.infer<typeof matchStateSchema>;

/** Convenience: the tally for one side of a reduced match state. */
export function tallyFor(state: MatchState, side: Side): ScoreTally {
  return side === 'AKA' ? state.derived.aka : state.derived.ao;
}
