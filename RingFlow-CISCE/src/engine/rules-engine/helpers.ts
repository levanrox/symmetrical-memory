import type { CompetitionContext, CompetitionFormat, ScoreType } from './enums';
import { RulesetLookupError } from './errors';
import { parseRuleset } from './parse';
import type { Ruleset } from './schema';

/**
 * Bout duration for an age group, in seconds (Art. 5.1).
 *
 * Throws rather than defaulting: silently falling back to a standard duration
 * when a category's age group is not configured would produce a tournament that
 * runs the wrong length of bout.
 */
export function matchDurationSeconds(ruleset: Ruleset, ageGroup: string): number {
  const seconds = ruleset.durationSeconds[ageGroup];

  if (seconds === undefined) {
    const known = Object.keys(ruleset.durationSeconds).sort().join(', ');
    throw new RulesetLookupError(
      `Ruleset "${ruleset.id}" defines no bout duration for age group "${ageGroup}". Known age groups: ${known}`,
    );
  }

  return seconds;
}

/** Points awarded for a score type (Art. 8.6). */
export function pointsFor(ruleset: Ruleset, scoreType: ScoreType): number {
  return ruleset.scoring[scoreType];
}

/** Whether a competition format is permitted by this ruleset (Art. 3.4). */
export function isFormatAllowed(ruleset: Ruleset, format: CompetitionFormat): boolean {
  return ruleset.formats.includes(format);
}

/** Whether a drawn result is permitted in the given context (Art. 12.2.5). */
export function hikiwakeAllowed(ruleset: Ruleset, context: CompetitionContext): boolean {
  return ruleset.penalties.hikiwakeAllowedIn.includes(context);
}

/** Nominal officials required per ring (Art. 4.1.1). */
export function panelSize(ruleset: Ruleset): number {
  const { referee, judges, kansa, scoreSupervisor, videoReviewJudge } = ruleset.panelOfficial;
  return referee + judges + kansa + scoreSupervisor + videoReviewJudge;
}

/** Fields an organiser may override when deriving a local ruleset. */
export interface RulesetOverrides {
  id: string;
  version: string;
  source?: string;
  basedOn?: string;
  durationSeconds?: Record<string, number>;
  durationReductionAllowed?: boolean;
  timeWarningSeconds?: number;
  scoring?: Partial<Ruleset['scoring']>;
  superiorityMargin?: number;
  decision?: Partial<Ruleset['decision']>;
  penalties?: Partial<Ruleset['penalties']>;
  scorekeepingSymbols?: Partial<Ruleset['scorekeepingSymbols']>;
  weighInToleranceKg?: Partial<Ruleset['weighInToleranceKg']>;
  formats?: Ruleset['formats'];
  defaultFormat?: Ruleset['defaultFormat'];
  team?: Partial<Ruleset['team']>;
  panelOfficial?: Partial<Ruleset['panelOfficial']>;
}

/**
 * Produces a local ruleset from a base one.
 *
 * Art. 17.1 lets national federations modify these rules for competitions
 * outside the WKF programme (but not the safety, scoring or penalty articles),
 * and Art. 5.2 lets organisers shorten bouts. Those are the two levers this
 * exists to serve, so a Karnataka ruleset is a data edit rather than a code
 * change.
 *
 * Scalar fields are replaced, nested objects are merged one level deep, and
 * arrays (`escalation`, `tieBreakOrder`, `formats`) are replaced wholesale.
 * The result is validated, so an override combination that breaks a rule — a
 * `defaultFormat` outside `formats`, say — fails here rather than on the floor.
 */
export function createDerivedRuleset(base: Ruleset, overrides: RulesetOverrides): Ruleset {
  const merged = {
    ...base,

    id: overrides.id,
    version: overrides.version,
    source: overrides.source ?? base.source,
    // A derived ruleset is, by default, derived from the ruleset it came from.
    basedOn: overrides.basedOn ?? base.basedOn ?? base.id,

    durationSeconds: { ...base.durationSeconds, ...overrides.durationSeconds },
    scoring: { ...base.scoring, ...overrides.scoring },
    decision: { ...base.decision, ...overrides.decision },
    penalties: { ...base.penalties, ...overrides.penalties },
    scorekeepingSymbols: { ...base.scorekeepingSymbols, ...overrides.scorekeepingSymbols },
    weighInToleranceKg: { ...base.weighInToleranceKg, ...overrides.weighInToleranceKg },
    team: { ...base.team, ...overrides.team },
    panelOfficial: { ...base.panelOfficial, ...overrides.panelOfficial },

    ...(overrides.durationReductionAllowed === undefined
      ? {}
      : { durationReductionAllowed: overrides.durationReductionAllowed }),
    ...(overrides.timeWarningSeconds === undefined
      ? {}
      : { timeWarningSeconds: overrides.timeWarningSeconds }),
    ...(overrides.superiorityMargin === undefined
      ? {}
      : { superiorityMargin: overrides.superiorityMargin }),
    ...(overrides.formats === undefined ? {} : { formats: overrides.formats }),
    ...(overrides.defaultFormat === undefined ? {} : { defaultFormat: overrides.defaultFormat }),
  };

  return parseRuleset(merged, overrides.id);
}
