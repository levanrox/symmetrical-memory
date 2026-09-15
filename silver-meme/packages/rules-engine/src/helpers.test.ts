import { describe, expect, it } from 'vitest';
import { RulesetLookupError, RulesetValidationError } from './errors';
import {
  createDerivedRuleset,
  hikiwakeAllowed,
  isFormatAllowed,
  matchDurationSeconds,
  panelSize,
  pointsFor,
} from './helpers';
import { getRuleset } from './rulesets/index';

const wkf = getRuleset('WKF_KUMITE_2026');

describe('matchDurationSeconds', () => {
  it('returns the Art. 5.1 duration for each WKF age group', () => {
    expect(matchDurationSeconds(wkf, 'senior')).toBe(180);
    expect(matchDurationSeconds(wkf, 'u21')).toBe(180);
    expect(matchDurationSeconds(wkf, 'junior')).toBe(120);
    expect(matchDurationSeconds(wkf, 'cadet')).toBe(120);
    expect(matchDurationSeconds(wkf, 'u14')).toBe(90);
  });

  it('throws for an unconfigured age group instead of guessing a duration', () => {
    try {
      matchDurationSeconds(wkf, 'veteran');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RulesetLookupError);

      const message = (error as RulesetLookupError).message;
      expect(message).toContain('veteran');
      expect(message).toContain('senior'); // lists what is available
    }
  });
});

describe('pointsFor', () => {
  it('maps score types to their Art. 8.6 values', () => {
    expect(pointsFor(wkf, 'YUKO')).toBe(1);
    expect(pointsFor(wkf, 'WAZA_ARI')).toBe(2);
    expect(pointsFor(wkf, 'IPPON')).toBe(3);
  });
});

describe('isFormatAllowed', () => {
  it('permits the formats listed in the ruleset', () => {
    expect(isFormatAllowed(wkf, 'SINGLE_ELIM_REPECHAGE')).toBe(true);
    expect(isFormatAllowed(wkf, 'ROUND_ROBIN')).toBe(true);
    expect(isFormatAllowed(wkf, 'POOLS_THEN_ELIM')).toBe(true);
  });

  it('refuses a format the ruleset does not list', () => {
    expect(isFormatAllowed(wkf, 'DOUBLE_ELIM')).toBe(false);
  });
});

describe('hikiwakeAllowed', () => {
  it('permits a draw in round-robin and team contexts', () => {
    expect(hikiwakeAllowed(wkf, 'ROUND_ROBIN')).toBe(true);
    expect(hikiwakeAllowed(wkf, 'TEAM')).toBe(true);
  });

  it('refuses a draw in individual elimination (Art. 12.2.5)', () => {
    expect(hikiwakeAllowed(wkf, 'INDIVIDUAL_ELIMINATION')).toBe(false);
  });
});

describe('panelSize', () => {
  it('counts the full Art. 4.1.1 panel', () => {
    expect(panelSize(wkf)).toBe(8); // 1 referee + 4 judges + kansa + score supervisor + VR
  });
});

describe('createDerivedRuleset', () => {
  it('overrides only what is supplied and inherits the rest', () => {
    const derived = createDerivedRuleset(wkf, {
      id: 'KARNATAKA_KUMITE_LOCAL_V1',
      version: '1.0',
      durationSeconds: { senior: 120 },
    });

    expect(derived.id).toBe('KARNATAKA_KUMITE_LOCAL_V1');
    expect(matchDurationSeconds(derived, 'senior')).toBe(120);
    // Untouched age groups survive the override.
    expect(matchDurationSeconds(derived, 'cadet')).toBe(120);
    expect(matchDurationSeconds(derived, 'u14')).toBe(90);
    // Everything not mentioned is inherited unchanged.
    expect(derived.scoring).toEqual(wkf.scoring);
    expect(derived.superiorityMargin).toBe(wkf.superiorityMargin);
    expect(derived.penalties.escalation).toEqual(wkf.penalties.escalation);
  });

  it('records the parent ruleset as the base', () => {
    const derived = createDerivedRuleset(wkf, { id: 'CHILD', version: '1.0' });
    expect(derived.basedOn).toBe('WKF_KUMITE_2026');
  });

  it('lets a caller name a different base explicitly', () => {
    const derived = createDerivedRuleset(wkf, {
      id: 'CHILD',
      version: '1.0',
      basedOn: 'SOMETHING_ELSE',
    });
    expect(derived.basedOn).toBe('SOMETHING_ELSE');
  });

  it('merges nested objects one level deep rather than replacing them', () => {
    const derived = createDerivedRuleset(wkf, {
      id: 'CHILD',
      version: '1.0',
      weighInToleranceKg: { male: 0.5 },
    });

    expect(derived.weighInToleranceKg).toEqual({ male: 0.5, female: 0.5 });
  });

  it('replaces arrays wholesale', () => {
    const derived = createDerivedRuleset(wkf, {
      id: 'CHILD',
      version: '1.0',
      penalties: { escalation: ['CHUI', 'HANSOKU'], chuiMax: 1 },
    });

    expect(derived.penalties.escalation).toEqual(['CHUI', 'HANSOKU']);
  });

  it('rejects an override combination that breaks a ruleset invariant', () => {
    // Narrowing the formats without moving defaultFormat off the removed one.
    expect(() =>
      createDerivedRuleset(wkf, {
        id: 'CHILD',
        version: '1.0',
        formats: ['ROUND_ROBIN'],
      }),
    ).toThrow(RulesetValidationError);
  });

  it('accepts a consistent narrowing of formats', () => {
    const derived = createDerivedRuleset(wkf, {
      id: 'CHILD',
      version: '1.0',
      formats: ['ROUND_ROBIN'],
      defaultFormat: 'ROUND_ROBIN',
    });

    expect(derived.formats).toEqual(['ROUND_ROBIN']);
    expect(isFormatAllowed(derived, 'SINGLE_ELIM_REPECHAGE')).toBe(false);
  });

  it('does not mutate the base ruleset', () => {
    const before = JSON.parse(JSON.stringify(wkf)) as unknown;

    createDerivedRuleset(wkf, {
      id: 'CHILD',
      version: '1.0',
      durationSeconds: { senior: 60 },
    });

    expect(JSON.parse(JSON.stringify(wkf))).toEqual(before);
  });
});
