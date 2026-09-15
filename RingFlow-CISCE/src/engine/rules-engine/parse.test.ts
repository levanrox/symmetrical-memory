import { describe, expect, it } from 'vitest';
import { RulesetValidationError, type RulesetIssue } from './errors';
import { parseRuleset } from './parse';

const VALID = {
  id: 'TEST_RULESET',
  version: '1.0',
  source: 'unit test',
  durationSeconds: { senior: 180 },
  durationReductionAllowed: false,
  timeWarningSeconds: 15,
  scoring: { YUKO: 1, WAZA_ARI: 2, IPPON: 3 },
  superiorityMargin: 8,
  decision: { senshu: true, tieBreakOrder: ['SENSHU', 'HANTEI'] },
  penalties: {
    chuiMax: 1,
    escalation: ['CHUI', 'HANSOKU'],
    hansokuChuiToHansoku: true,
    shikkaku: true,
    kiken: true,
    hikiwakeAllowedIn: ['ROUND_ROBIN'],
    kikenScoreDefault: { team: '8-0', individualRoundRobin: '4-0' },
  },
  scorekeepingSymbols: {
    IPPON: '3',
    WAZA_ARI: '2',
    YUKO: '1',
    SENSHU: 'SEN',
    KACHI: 'KACHI',
    MAKE: 'MAKE',
    HIKIWAKE: 'HIKIWAKE',
    KIKEN: 'KK',
    CHUI_1: '1C',
    CHUI_2: '2C',
    CHUI_3: '3C',
    HANSOKU_CHUI: 'HC',
    HANSOKU: 'H',
    SHIKKAKU: 'S',
  },
  weighInToleranceKg: { male: 0.2, female: 0.5 },
  formats: ['SINGLE_ELIM_REPECHAGE'],
  defaultFormat: 'SINGLE_ELIM_REPECHAGE',
  team: {
    male: { bouts: 5, minPresent: 3, maxSquad: 8 },
    female: { bouts: 3, minPresent: 2, maxSquad: 5 },
    mixed: { allowedBoutCounts: [4, 6], equalGenders: true },
  },
  panelOfficial: {
    referee: 1,
    judges: 4,
    kansa: 1,
    scoreSupervisor: 1,
    videoReviewJudge: 1,
    youthLeagueJudges: 2,
  },
};

function withPatch(patch: Record<string, unknown>): unknown {
  return { ...VALID, ...patch };
}

function withPenaltyPatch(patch: Record<string, unknown>): unknown {
  return { ...VALID, penalties: { ...VALID.penalties, ...patch } };
}

function withDecisionPatch(patch: Record<string, unknown>): unknown {
  return { ...VALID, decision: { ...VALID.decision, ...patch } };
}

/** Runs the parser and returns the issues it collected. */
function issuesFor(input: unknown): readonly RulesetIssue[] {
  try {
    parseRuleset(input);
  } catch (error) {
    if (error instanceof RulesetValidationError) {
      return error.issues;
    }
    throw error;
  }

  throw new Error('expected parseRuleset to reject the input');
}

function expectIssueAt(input: unknown, path: string): void {
  const issues = issuesFor(input);
  expect(
    issues.map((i) => i.path),
    `expected an issue at "${path}", got: ${JSON.stringify(issues)}`,
  ).toContain(path);
}

describe('parseRuleset — acceptance', () => {
  it('accepts a well-formed ruleset', () => {
    expect(parseRuleset(VALID).id).toBe('TEST_RULESET');
  });

  it('accepts an optional basedOn', () => {
    expect(parseRuleset(withPatch({ basedOn: 'PARENT' })).basedOn).toBe('PARENT');
  });
});

describe('parseRuleset — rejection', () => {
  it('rejects unknown top-level keys rather than ignoring them', () => {
    // A typo like `superiorityMargins` must not silently do nothing.
    expectIssueAt(withPatch({ superiorityMargins: 8 }), '');
  });

  it('rejects score values that do not increase', () => {
    expectIssueAt(withPatch({ scoring: { YUKO: 3, WAZA_ARI: 2, IPPON: 1 } }), 'scoring');
  });

  it('rejects a non-integer or non-positive score value', () => {
    expectIssueAt(withPatch({ scoring: { YUKO: 0, WAZA_ARI: 2, IPPON: 3 } }), 'scoring.YUKO');
  });

  it('rejects an escalation whose CHUI count contradicts chuiMax', () => {
    expectIssueAt(withPenaltyPatch({ chuiMax: 2 }), 'penalties.escalation');
  });

  it('rejects an escalation that jumps severity out of order', () => {
    expectIssueAt(
      withPenaltyPatch({ chuiMax: 1, escalation: ['HANSOKU', 'CHUI'] }),
      'penalties.escalation',
    );
  });

  it('rejects a repeated tie-break criterion', () => {
    expectIssueAt(withDecisionPatch({ tieBreakOrder: ['SENSHU', 'SENSHU'] }), 'decision.tieBreakOrder');
  });

  it('rejects HANTEI when it is not the last tie-break criterion', () => {
    expectIssueAt(
      withDecisionPatch({ tieBreakOrder: ['HANTEI', 'SENSHU'] }),
      'decision.tieBreakOrder',
    );
  });

  it('rejects an empty tie-break order', () => {
    expectIssueAt(withDecisionPatch({ tieBreakOrder: [] }), 'decision.tieBreakOrder');
  });

  it('rejects a defaultFormat that is not among the declared formats', () => {
    expectIssueAt(withPatch({ defaultFormat: 'ROUND_ROBIN' }), 'defaultFormat');
  });

  it('rejects an empty format list', () => {
    expectIssueAt(withPatch({ formats: [] }), 'formats');
  });

  it('rejects an empty duration map', () => {
    expectIssueAt(withPatch({ durationSeconds: {} }), 'durationSeconds');
  });

  it('rejects a non-positive duration', () => {
    expectIssueAt(withPatch({ durationSeconds: { senior: 0 } }), 'durationSeconds.senior');
  });

  it('rejects a team composition where minPresent exceeds bouts', () => {
    expectIssueAt(
      withPatch({
        team: {
          ...VALID.team,
          male: { bouts: 3, minPresent: 5, maxSquad: 8 },
        },
      }),
      'team.male',
    );
  });

  it('rejects a team composition where bouts exceeds maxSquad', () => {
    expectIssueAt(
      withPatch({
        team: {
          ...VALID.team,
          female: { bouts: 9, minPresent: 2, maxSquad: 5 },
        },
      }),
      'team.female',
    );
  });

  it('rejects an empty id', () => {
    expectIssueAt(withPatch({ id: '' }), 'id');
  });

  it('rejects a missing required section', () => {
    const withoutScoring: Record<string, unknown> = { ...VALID };
    delete withoutScoring.scoring;

    expectIssueAt(withoutScoring, 'scoring');
  });
});

describe('parseRuleset — error reporting', () => {
  it('reports the ruleset id when it can determine it', () => {
    try {
      parseRuleset(withPatch({ superiorityMargin: -1 }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RulesetValidationError);
      const typed = error as RulesetValidationError;
      expect(typed.code).toBe('INVALID_RULESET');
      expect(typed.message).toContain('TEST_RULESET');
      expect(typed.issues.length).toBeGreaterThan(0);
    }
  });

  it('uses an explicit id hint when the payload has none', () => {
    try {
      parseRuleset({ nonsense: true }, 'HINTED_ID');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as RulesetValidationError).message).toContain('HINTED_ID');
    }
  });

  it('omits the id when neither the payload nor a hint provides one', () => {
    try {
      parseRuleset(42);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as RulesetValidationError).message).toContain('Ruleset is invalid');
    }
  });

  it('collects every problem rather than stopping at the first', () => {
    const issues = issuesFor(
      withPatch({ id: '', version: '', superiorityMargin: -1 }),
    );

    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('carries a machine-readable code on each issue', () => {
    for (const issue of issuesFor(withPatch({ superiorityMargin: -1 }))) {
      expect(typeof issue.code).toBe('string');
      expect(issue.code.length).toBeGreaterThan(0);
    }
  });
});
