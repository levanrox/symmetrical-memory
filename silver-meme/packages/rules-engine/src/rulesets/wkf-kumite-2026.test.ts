import { describe, expect, it } from 'vitest';
import { getRuleset, hasRuleset, listRulesets } from '../index';
import { RulesetLookupError } from '../errors';

const wkf = getRuleset('WKF_KUMITE_2026');

describe('WKF_KUMITE_2026 — transcription of the rulebook', () => {
  it('records the bout durations from Art. 5.1, in seconds', () => {
    expect(wkf.durationSeconds).toEqual({
      senior: 180,
      u21: 180,
      junior: 120,
      cadet: 120,
      u14: 90,
    });
  });

  it('permits reduced durations for large entry fields and warns at 15s (Art. 5.2, 5.4)', () => {
    expect(wkf.durationReductionAllowed).toBe(true);
    expect(wkf.timeWarningSeconds).toBe(15);
  });

  it('uses the score values from Art. 8.6', () => {
    expect(wkf.scoring).toEqual({ YUKO: 1, WAZA_ARI: 2, IPPON: 3 });
  });

  it('ends a bout on an eight-point lead (Art. 7.7)', () => {
    expect(wkf.superiorityMargin).toBe(8);
  });

  it('resolves a tied bout by SENSHU, then IPPON count, then WAZA-ARI count, then HANTEI (Art. 12.2)', () => {
    expect(wkf.decision.senshu).toBe(true);
    expect(wkf.decision.tieBreakOrder).toEqual([
      'SENSHU',
      'HIGHER_IPPON_COUNT',
      'HIGHER_WAZA_ARI_COUNT',
      'HANTEI',
    ]);
  });

  it('escalates CHUI three times, then HANSOKU CHUI, then HANSOKU (Art. 10.2, 10.3)', () => {
    expect(wkf.penalties.chuiMax).toBe(3);
    expect(wkf.penalties.escalation).toEqual([
      'CHUI',
      'CHUI',
      'CHUI',
      'HANSOKU_CHUI',
      'HANSOKU',
    ]);
    expect(wkf.penalties.hansokuChuiToHansoku).toBe(true);
    expect(wkf.penalties.shikkaku).toBe(true);
    expect(wkf.penalties.kiken).toBe(true);
  });

  it('permits a draw only in round-robin and team contexts (Art. 12.2.5)', () => {
    expect(wkf.penalties.hikiwakeAllowedIn).toEqual(['ROUND_ROBIN', 'TEAM']);
  });

  it('records a walkover as 8-0 in teams and 4-0 in individual round-robin (Art. 6.2)', () => {
    expect(wkf.penalties.kikenScoreDefault).toEqual({
      team: '8-0',
      individualRoundRobin: '4-0',
    });
  });

  it('carries the scorekeeper notation from Art. 12.6', () => {
    expect(wkf.scorekeepingSymbols).toEqual({
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
    });
  });

  it('uses the weigh-in tolerances from Art. 3.2.2 d', () => {
    expect(wkf.weighInToleranceKg).toEqual({ male: 0.2, female: 0.5 });
  });

  it('offers the competition formats of Art. 3.4, defaulting to elimination with repechage', () => {
    expect(wkf.formats).toEqual(['SINGLE_ELIM_REPECHAGE', 'ROUND_ROBIN', 'POOLS_THEN_ELIM']);
    expect(wkf.defaultFormat).toBe('SINGLE_ELIM_REPECHAGE');
  });

  it('records the team compositions from Art. 3.5', () => {
    expect(wkf.team.male).toEqual({ bouts: 5, minPresent: 3, maxSquad: 8 });
    expect(wkf.team.female).toEqual({ bouts: 3, minPresent: 2, maxSquad: 5 });
    expect(wkf.team.mixed).toEqual({ allowedBoutCounts: [4, 6], equalGenders: true });
  });

  it('records the referee panel from Art. 4.1.1', () => {
    expect(wkf.panelOfficial).toEqual({
      referee: 1,
      judges: 4,
      kansa: 1,
      scoreSupervisor: 1,
      videoReviewJudge: 1,
      youthLeagueJudges: 2,
    });
  });

  it('attributes itself to a named source', () => {
    expect(wkf.source).toContain('WKF Kumite Competition Rules 2026');
    expect(wkf.version).toBe('2026.00');
  });
});

describe('ruleset registry', () => {
  it('resolves a registered ruleset by id', () => {
    expect(hasRuleset('WKF_KUMITE_2026')).toBe(true);
    expect(getRuleset('WKF_KUMITE_2026').id).toBe('WKF_KUMITE_2026');
  });

  it('reports an unknown ruleset rather than returning undefined', () => {
    expect(hasRuleset('NOPE')).toBe(false);

    try {
      getRuleset('NOPE');
      expect.unreachable('getRuleset should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RulesetLookupError);
      expect((error as RulesetLookupError).code).toBe('RULESET_LOOKUP_FAILED');
      // The message names what *is* available, so a typo is self-correcting.
      expect((error as RulesetLookupError).message).toContain('WKF_KUMITE_2026');
    }
  });

  it('returns rulesets sorted by id for stable output', () => {
    const ids = listRulesets().map((r) => r.id);
    expect([...ids]).toEqual([...ids].sort());
  });

  it('does not ship a Karnataka ruleset until its categories are verified', () => {
    // Guard against someone adding a guessed ruleset: it must be based on
    // verified federation data (backlog D6), not invented here.
    for (const ruleset of listRulesets()) {
      expect(ruleset.basedOn).toBeUndefined();
    }
  });
});
