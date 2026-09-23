import { describe, expect, it } from 'vitest';
import { getRuleset } from '../index';
import { getKataName, isValidKataNumber, KATA_COUNT, KATA_LIST } from './kata-list';
import {
  decideKataBout,
  KataDecisionError,
  validateJudgeScore,
  validateKataRepetition,
  type KataJudgeScore,
} from './kata-decision';

const wkf = getRuleset('WKF_KATA_2026');

function judge(judgeId: string, aka: number | null, ao: number | null): KataJudgeScore {
  return { judgeId, aka, ao };
}

describe('WKF_KATA_2026 — transcription of the rulebook', () => {
  it('attributes itself to a named source', () => {
    expect(wkf.version).toBe('2026.00');
    expect(wkf.source).toContain('Kata Competition Rules 2026');
  });

  it('names the Art. 3.3.1 competition formats, defaulting to elimination with repechage', () => {
    expect(wkf.formats).toEqual([
      'SINGLE_ELIM_REPECHAGE',
      'GROUPS_THEN_ELIMINATION',
      'ROUND_ROBIN',
    ]);
    expect(wkf.defaultFormat).toBe('SINGLE_ELIM_REPECHAGE');
  });

  it('resolves a tied vote by total score, then the moderator (HANTEI)', () => {
    expect(wkf.decision.senshu).toBe(false);
    expect(wkf.decision.tieBreakOrder).toEqual(['HIGHER_TOTAL_SCORE', 'HANTEI']);
  });

  it('uses 5 judges for eliminations (Art. 4.1); round-robin rounds use 7', () => {
    expect(wkf.panelOfficial.judges).toBe(5);
    expect(wkf.panelOfficial.referee).toBe(0);
  });

  it('awards 4 votes for a KIKEN win and allows no draws (Art. 5.5.2)', () => {
    expect(wkf.penalties.kikenScoreDefault).toEqual({
      team: '4 votes',
      individualRoundRobin: '4 votes',
    });
    expect(wkf.penalties.hikiwakeAllowedIn).toEqual([]);
  });
});

describe('kata list (Appendix 1)', () => {
  it('holds the full official 1-102 list, numbered sequentially with no gaps or duplicates', () => {
    expect(KATA_COUNT).toBe(102);
    expect(KATA_LIST.map((k) => k.number)).toEqual(
      Array.from({ length: 102 }, (_, i) => i + 1),
    );
  });

  it('looks names up by number — the number is authoritative (Art. 6.3)', () => {
    expect(getKataName(1)).toBe('Anan');
    expect(getKataName(40)).toBe('Kanku Dai');
    expect(getKataName(102)).toBe('Wanshu');
    expect(getKataName(0)).toBeUndefined();
    expect(getKataName(103)).toBeUndefined();
  });

  it('validates kata numbers', () => {
    expect(isValidKataNumber(1)).toBe(true);
    expect(isValidKataNumber(102)).toBe(true);
    expect(isValidKataNumber(0)).toBe(false);
    expect(isValidKataNumber(103)).toBe(false);
    expect(isValidKataNumber(7.5)).toBe(false);
  });
});

describe('validateJudgeScore (Art. 5.4.1)', () => {
  it('accepts 5.0-10.0 in 0.1 steps', () => {
    expect(validateJudgeScore(5.0)).toBe(true);
    expect(validateJudgeScore(7.5)).toBe(true);
    expect(validateJudgeScore(9.9)).toBe(true);
    expect(validateJudgeScore(10.0)).toBe(true);
  });

  it('rejects marks outside the scale', () => {
    expect(validateJudgeScore(4.9)).toBe(false);
    expect(validateJudgeScore(10.1)).toBe(false);
    expect(validateJudgeScore(0)).toBe(false); // 0.0 is the DQ mark, not a score
  });

  it('rejects marks that are not 0.1 steps', () => {
    expect(validateJudgeScore(7.55)).toBe(false);
    expect(validateJudgeScore(8.05)).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(validateJudgeScore(NaN)).toBe(false);
    expect(validateJudgeScore(Infinity)).toBe(false);
  });
});

describe('decideKataBout — majority of votes decides (Art. 5.4.2, 5.5.1)', () => {
  it('decides 3-2 for AKA with 5 judges', () => {
    const decision = decideKataBout([
      judge('j1', 8.0, 7.5),
      judge('j2', 8.5, 7.0),
      judge('j3', 9.0, 8.0),
      judge('j4', 7.0, 8.5),
      judge('j5', 7.5, 8.0),
    ]);
    expect(decision.winner).toBe('AKA');
    expect(decision.method).toBe('MAJORITY');
    expect(decision.akaVotes).toBe(3);
    expect(decision.aoVotes).toBe(2);
    expect(decision.judgesCounted).toBe(5);
  });

  it('decides 4-1 for AO with 5 judges', () => {
    const decision = decideKataBout([
      judge('j1', 8.0, 7.5),
      judge('j2', 7.0, 8.5),
      judge('j3', 7.5, 9.0),
      judge('j4', 8.0, 8.5),
      judge('j5', 7.0, 9.5),
    ]);
    expect(decision.winner).toBe('AO');
    expect(decision.method).toBe('MAJORITY');
    expect(decision.akaVotes).toBe(1);
    expect(decision.aoVotes).toBe(4);
  });

  it('decides 5-0 unanimously for AKA', () => {
    const decision = decideKataBout(
      ['j1', 'j2', 'j3', 'j4', 'j5'].map((id) => judge(id, 9.0, 8.0)),
    );
    expect(decision.winner).toBe('AKA');
    expect(decision.akaVotes).toBe(5);
    expect(decision.aoVotes).toBe(0);
  });

  it('decides 4-3 with a 7-judge round-robin panel', () => {
    const scores: KataJudgeScore[] = [
      judge('j1', 8.0, 7.5),
      judge('j2', 8.5, 7.0),
      judge('j3', 9.0, 8.0),
      judge('j4', 8.0, 7.5),
      judge('j5', 7.5, 8.0),
      judge('j6', 7.0, 8.5),
      judge('j7', 7.5, 9.0),
    ];
    const decision = decideKataBout(scores);
    expect(decision.winner).toBe('AKA');
    expect(decision.method).toBe('MAJORITY');
    expect(decision.akaVotes).toBe(4);
    expect(decision.aoVotes).toBe(3);
    expect(decision.judgesCounted).toBe(7);
  });

  it('decides by votes, not by point sums — a lopsided minority cannot win', () => {
    // AO wins two judges by huge margins, AKA wins three by a hair.
    // Point sums favour AO, but votes decide the bout (Art. 5.4.2).
    const decision = decideKataBout([
      judge('j1', 8.1, 8.0),
      judge('j2', 8.1, 8.0),
      judge('j3', 8.1, 8.0),
      judge('j4', 5.0, 10.0),
      judge('j5', 5.0, 10.0),
    ]);
    expect(decision.winner).toBe('AKA');
    expect(decision.method).toBe('MAJORITY');
    expect(decision.akaVotes).toBe(3);
    expect(decision.aoVotes).toBe(2);
    expect(decision.aoTotal).toBeGreaterThan(decision.akaTotal);
  });
});

describe('decideKataBout — half-votes do not count', () => {
  it('excludes a judge who submitted only one mark from votes, totals and count', () => {
    const decision = decideKataBout([
      judge('j1', 8.0, 7.0), // AKA vote
      judge('j2', 7.0, 8.0), // AO vote
      judge('j3', 9.0, 8.0), // AKA vote
      judge('j4', 7.5, 9.0), // AO vote
      judge('j5', 9.5, null), // half-vote: must not count
    ]);
    // Votes 2-2; totals over counted judges: AKA 31.5, AO 32.0.
    expect(decision.judgesCounted).toBe(4);
    expect(decision.akaVotes).toBe(2);
    expect(decision.aoVotes).toBe(2);
    expect(decision.winner).toBe('AO');
    expect(decision.method).toBe('TOTAL_SCORE_TIEBREAK');
    expect(decision.akaTotal).toBeCloseTo(31.5, 5);
    expect(decision.aoTotal).toBeCloseTo(32.0, 5);
  });

  it('counts no vote when a judge marks both sides equally', () => {
    const decision = decideKataBout([
      judge('j1', 8.0, 8.0), // no vote either way
      judge('j2', 9.0, 7.0), // AKA vote
      judge('j3', 6.0, 8.5), // AO vote
    ]);
    expect(decision.judgesCounted).toBe(3);
    expect(decision.akaVotes).toBe(1);
    expect(decision.aoVotes).toBe(1);
    // Totals: AKA 23.0, AO 23.5 — AO wins the tiebreak.
    expect(decision.winner).toBe('AO');
    expect(decision.method).toBe('TOTAL_SCORE_TIEBREAK');
  });
});

describe('decideKataBout — tiebreak ladder', () => {
  it('breaks a tied vote on total score sum', () => {
    const decision = decideKataBout([
      judge('j1', 8.0, 7.5),
      judge('j2', 7.0, 8.5),
    ]);
    expect(decision.akaVotes).toBe(1);
    expect(decision.aoVotes).toBe(1);
    expect(decision.winner).toBe('AO');
    expect(decision.method).toBe('TOTAL_SCORE_TIEBREAK');
    expect(decision.akaTotal).toBeCloseTo(15.0, 5);
    expect(decision.aoTotal).toBeCloseTo(16.0, 5);
  });

  it('falls back to the moderator decision when votes and totals are tied', () => {
    const scores = [judge('j1', 8.0, 7.5), judge('j2', 7.5, 8.0)];
    const decision = decideKataBout(scores, { moderatorDecision: 'AKA' });
    expect(decision.akaVotes).toBe(1);
    expect(decision.aoVotes).toBe(1);
    expect(decision.akaTotal).toBeCloseTo(decision.aoTotal, 5);
    expect(decision.winner).toBe('AKA');
    expect(decision.method).toBe('MODERATOR');
  });

  it('throws when votes and totals are tied with no moderator decision', () => {
    const scores = [judge('j1', 8.0, 7.5), judge('j2', 7.5, 8.0)];
    expect(() => decideKataBout(scores)).toThrow(KataDecisionError);
    expect(() => decideKataBout(scores)).toThrow(/moderator/i);
  });
});

describe('decideKataBout — disqualification overrides everything', () => {
  it('lets the opponent win regardless of votes when a side is disqualified', () => {
    const scores: KataJudgeScore[] = [
      'j1',
      'j2',
      'j3',
      'j4',
      'j5',
    ].map((id) => ({ judgeId: id, aka: 9.5, ao: 7.0, disqualified: null }));
    scores[0] = { ...scores[0], disqualified: 'AKA' };
    const decision = decideKataBout(scores);
    expect(decision.winner).toBe('AO');
    expect(decision.method).toBe('DISQUALIFICATION');
    // The disqualified side effectively scores 0.0.
    expect(decision.akaTotal).toBe(0);
    expect(decision.aoTotal).toBeCloseTo(35.0, 5);
  });

  it('treats a 0.0 mark as a disqualification (Art. 5.4.1)', () => {
    const decision = decideKataBout([
      judge('j1', 9.0, 0.0),
      judge('j2', 9.5, 8.0),
    ]);
    expect(decision.winner).toBe('AKA');
    expect(decision.method).toBe('DISQUALIFICATION');
  });

  it('throws when both sides are disqualified', () => {
    const scores: KataJudgeScore[] = [
      { judgeId: 'j1', aka: null, ao: null, disqualified: 'AKA' },
      { judgeId: 'j2', aka: null, ao: null, disqualified: 'AO' },
    ];
    expect(() => decideKataBout(scores)).toThrow(KataDecisionError);
  });
});

describe('validateKataRepetition (Art. 5.2.1, 5.2.2)', () => {
  it('accepts a first kata choice', () => {
    expect(validateKataRepetition([], 40, 'senior')).toEqual({ ok: true });
  });

  it('rejects the same kata twice in a row', () => {
    const check = validateKataRepetition([40, 12], 12, 'senior');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/twice in a row/i);
  });

  it('rejects a kata already performed twice in the event', () => {
    const check = validateKataRepetition([40, 12, 40], 40, 'senior');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/twice/i);
  });

  it('accepts a repeat that respects the limits (second use, not in a row)', () => {
    expect(validateKataRepetition([40, 12], 40, 'senior')).toEqual({ ok: true });
  });

  it('rejects a sixth different kata', () => {
    const check = validateKataRepetition([1, 2, 3, 4, 5], 6, 'senior');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/5 different/i);
  });

  it('rejects a fifth different kata for U14', () => {
    const check = validateKataRepetition([1, 2, 3, 4], 5, 'U14');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/4 different/i);
  });

  it('accepts a U14 repeat from the fifth round under the same principles', () => {
    expect(validateKataRepetition([1, 2, 3, 4], 2, 'U14')).toEqual({ ok: true });
  });

  it('rejects kata numbers outside the official list', () => {
    expect(validateKataRepetition([], 0, 'senior').ok).toBe(false);
    expect(validateKataRepetition([], 103, 'senior').ok).toBe(false);
    expect(validateKataRepetition([], 7.5, 'senior').ok).toBe(false);
  });
});
