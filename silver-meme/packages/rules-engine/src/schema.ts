import { z } from 'zod';
import { COMPETITION_CONTEXTS, COMPETITION_FORMATS, PENALTY_LEVELS, TIE_BREAK_CRITERIA } from './enums';

const nonEmpty = z.string().min(1);
const positiveInt = z.int().positive();
const nonNegativeInt = z.int().nonnegative();

/**
 * Note on `path` in refinements below: zod prepends a sub-schema's own location
 * to any `path` given here, so a refine attached to a nested schema must use a
 * path relative to *that* schema (often just the offending field, or empty).
 * Only refinements on the root schema use root-relative paths.
 */

/** Art. 8.6. */
const scoreValuesSchema = z
  .strictObject({
    YUKO: positiveInt,
    WAZA_ARI: positiveInt,
    IPPON: positiveInt,
  })
  .refine((s) => s.YUKO < s.WAZA_ARI && s.WAZA_ARI < s.IPPON, {
    error: 'score values must increase YUKO < WAZA_ARI < IPPON',
    path: [],
  });

/** Art. 12.2. */
const decisionSchema = z
  .strictObject({
    senshu: z.boolean(),
    tieBreakOrder: z.array(z.enum(TIE_BREAK_CRITERIA)).min(1),
  })
  .refine((d) => new Set(d.tieBreakOrder).size === d.tieBreakOrder.length, {
    error: 'tie-break criteria must not repeat',
    path: ['tieBreakOrder'],
  })
  // Art. 12.2.4: HANTEI is the vote of last resort, so nothing may follow it.
  .refine((d) => !d.tieBreakOrder.includes('HANTEI') || d.tieBreakOrder.at(-1) === 'HANTEI', {
    error: 'HANTEI must be the last tie-break criterion',
    path: ['tieBreakOrder'],
  });

/** Art. 10. */
const penaltySchema = z
  .strictObject({
    chuiMax: nonNegativeInt,
    escalation: z.array(z.enum(PENALTY_LEVELS)).min(1),
    hansokuChuiToHansoku: z.boolean(),
    shikkaku: z.boolean(),
    kiken: z.boolean(),
    hikiwakeAllowedIn: z.array(z.enum(COMPETITION_CONTEXTS)),
    kikenScoreDefault: z.strictObject({
      team: nonEmpty,
      individualRoundRobin: nonEmpty,
    }),
  })
  .refine((p) => p.escalation.filter((step) => step === 'CHUI').length === p.chuiMax, {
    error: 'escalation must contain exactly `chuiMax` CHUI steps',
    path: ['escalation'],
  })
  .refine(
    (p) => {
      // Art. 10.2-10.3: CHUI* -> HANSOKU CHUI -> HANSOKU, never out of order.
      const severity: Record<(typeof PENALTY_LEVELS)[number], number> = {
        CHUI: 0,
        HANSOKU_CHUI: 1,
        HANSOKU: 2,
        SHIKKAKU: 3,
      };
      return p.escalation.every((step, index) => {
        const previous = index === 0 ? undefined : p.escalation[index - 1];
        return previous === undefined || severity[previous] <= severity[step];
      });
    },
    {
      error: 'escalation steps must be in non-decreasing severity order',
      path: ['escalation'],
    },
  );

/** Art. 12.6 — the symbols a score supervisor writes on the paper sheet. */
const scorekeepingSymbolsSchema = z.strictObject({
  IPPON: nonEmpty,
  WAZA_ARI: nonEmpty,
  YUKO: nonEmpty,
  SENSHU: nonEmpty,
  KACHI: nonEmpty,
  MAKE: nonEmpty,
  HIKIWAKE: nonEmpty,
  KIKEN: nonEmpty,
  CHUI_1: nonEmpty,
  CHUI_2: nonEmpty,
  CHUI_3: nonEmpty,
  HANSOKU_CHUI: nonEmpty,
  HANSOKU: nonEmpty,
  SHIKKAKU: nonEmpty,
});

/** Art. 3.2.2 d. */
const weighInToleranceSchema = z.strictObject({
  male: z.number().nonnegative(),
  female: z.number().nonnegative(),
});

/** Art. 3.5. */
const teamSideSchema = z
  .strictObject({ bouts: positiveInt, minPresent: positiveInt, maxSquad: positiveInt })
  .refine((t) => t.minPresent <= t.bouts && t.bouts <= t.maxSquad, {
    error: 'expected minPresent <= bouts <= maxSquad',
    path: [],
  });

const teamSchema = z.strictObject({
  male: teamSideSchema,
  female: teamSideSchema,
  mixed: z.strictObject({
    allowedBoutCounts: z.array(positiveInt).min(1),
    equalGenders: z.boolean(),
  }),
});

/** Art. 4.1 and Appendix 5 — how many officials a ring nominally needs. */
const panelOfficialSchema = z.strictObject({
  referee: nonNegativeInt,
  judges: nonNegativeInt,
  kansa: nonNegativeInt,
  scoreSupervisor: nonNegativeInt,
  videoReviewJudge: nonNegativeInt,
  youthLeagueJudges: nonNegativeInt,
});

export const rulesetSchema = z
  .strictObject({
    id: nonEmpty,
    version: nonEmpty,
    source: nonEmpty,
    basedOn: nonEmpty.optional(),
    durationSeconds: z.record(z.string(), positiveInt),
    durationReductionAllowed: z.boolean(),
    timeWarningSeconds: nonNegativeInt,
    scoring: scoreValuesSchema,
    superiorityMargin: positiveInt,
    decision: decisionSchema,
    penalties: penaltySchema,
    scorekeepingSymbols: scorekeepingSymbolsSchema,
    weighInToleranceKg: weighInToleranceSchema,
    formats: z.array(z.enum(COMPETITION_FORMATS)).min(1),
    defaultFormat: z.enum(COMPETITION_FORMATS),
    team: teamSchema,
    panelOfficial: panelOfficialSchema,
  })
  // Root-level refinements, so these paths are root-relative.
  .refine((r) => Object.keys(r.durationSeconds).length > 0, {
    error: 'at least one age group must define a bout duration',
    path: ['durationSeconds'],
  })
  .refine((r) => r.formats.includes(r.defaultFormat), {
    error: 'defaultFormat must be one of the declared formats',
    path: ['defaultFormat'],
  });

export type Ruleset = z.infer<typeof rulesetSchema>;
export type RulesetInput = z.input<typeof rulesetSchema>;
