import type { Side } from '../enums';
import { getKataName, isValidKataNumber } from './kata-list';

/**
 * Pure decision logic for WKF kata bouts (Kata Competition Rules 2026.0).
 *
 * No DB, no Next.js, no I/O: these functions take plain data in and return a
 * plain decision out, so the bout reducer and any test can call them.
 *
 * Rulebook anchors (all from the 2026.0 master copy):
 * - Art. 5.4.1: each performance is scored 5.0-10.0 in 0.1 steps; a
 *   disqualification is indicated by a 0.0 score.
 * - Art. 5.4.2: each judge's winner pick comes from the relative marks that
 *   judge gave the two sides; the bout winner is decided by the MAJORITY of
 *   judges' votes — not by point sums.
 * - Art. 5.5.1 / 5.10.1: elimination bouts are decided by majority of votes.
 * - Art. 5.2.1/5.2.2: kata repetition limits (max 5 different kata, 4 for U14;
 *   never twice in a row; no kata more than twice per event).
 */

// Marks are carried internally in tenths of a point so 0.1-step arithmetic
// stays exact (no 8.1 + 7.2 = 15.299999999999999 surprises).
const MIN_MARK_TENTHS = 50; // 5.0
const MAX_MARK_TENTHS = 100; // 10.0
const DQ_MARK_TENTHS = 0; // Art. 5.4.1: disqualification is indicated by 0.0.

/**
 * True when `n` is a legal judge's mark: 5.0-10.0 inclusive in 0.1 steps
 * (Art. 5.4.1). A 0.0 disqualification mark is NOT a legal score — it is
 * handled by the DQ branch of {@link decideKataBout}, not here.
 */
export function validateJudgeScore(n: number): boolean {
  if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  const tenths = Math.round(n * 10);
  // The round-trip check rejects values that are not exactly a 0.1 step
  // (e.g. 7.55 rounds to 76 but 76/10 !== 7.55).
  if (Math.abs(tenths / 10 - n) > 1e-9) return false;
  return tenths >= MIN_MARK_TENTHS && tenths <= MAX_MARK_TENTHS;
}

/** One judge's marks for a kata bout. `null` = not yet submitted. */
export interface KataJudgeScore {
  judgeId: string;
  aka: number | null;
  ao: number | null;
  /**
   * Side disqualified for this bout (KIKEN/HANSOKU/SHIKKAKU), or null when
   * neither side is disqualified. The disqualified side effectively scores
   * 0.0 and the opponent wins regardless of votes (Art. 5.4.1, 5.8).
   */
  disqualified?: Side | null;
}

export type KataDecisionMethod =
  | 'MAJORITY'
  | 'TOTAL_SCORE_TIEBREAK'
  | 'MODERATOR'
  | 'DISQUALIFICATION';

export interface KataBoutDecision {
  winner: Side;
  akaVotes: number;
  aoVotes: number;
  /** Sum of the side's marks (in points), over judges who submitted both marks. */
  akaTotal: number;
  aoTotal: number;
  method: KataDecisionMethod;
  /** Judges whose vote counted: both marks submitted (no half-votes). */
  judgesCounted: number;
}

export interface KataBoutOptions {
  /** Head-judge/moderator pick, required when votes AND total scores are tied. */
  moderatorDecision?: Side;
}

export class KataDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KataDecisionError';
  }
}

function toTenths(mark: number): number {
  return Math.round(mark * 10);
}

/**
 * Decides a kata bout from the judges' marks.
 *
 * - A judge's vote counts ONLY when BOTH their AKA and AO marks are submitted
 *   (no half-votes). Their vote goes to the side they marked higher
 *   (Art. 5.4.2).
 * - Majority of votes decides the bout (Art. 5.5.1); point sums are only the
 *   first tiebreak.
 * - Tiebreak ladder when votes are tied (possible with even-sized partial
 *   panels): (a) higher total score sum across the counted judges wins,
 *   (b) otherwise the moderator decision (HANTEI) decides.
 * - A disqualified side scores 0.0 and the opponent wins regardless of votes
 *   (Art. 5.4.1); indicated either by the `disqualified` flag or a 0.0 mark.
 *
 * Callers should validate marks with {@link validateJudgeScore} at entry
 * time; this function assumes marks are legal 0.1-step values (or 0.0 for DQ).
 */
export function decideKataBout(
  scores: readonly KataJudgeScore[],
  opts: KataBoutOptions = {},
): KataBoutDecision {
  // Disqualification is checked first: it overrides everything.
  const dqSides = new Set<Side>();
  for (const s of scores) {
    if (s.disqualified === 'AKA' || s.disqualified === 'AO') dqSides.add(s.disqualified);
    if (s.aka === 0) dqSides.add('AKA');
    if (s.ao === 0) dqSides.add('AO');
  }
  if (dqSides.size === 2) {
    throw new KataDecisionError('Both sides are disqualified: no winner can be decided.');
  }
  const disqualified: Side | null = dqSides.has('AKA') ? 'AKA' : dqSides.has('AO') ? 'AO' : null;

  let akaVotes = 0;
  let aoVotes = 0;
  let akaTenths = 0;
  let aoTenths = 0;
  let judgesCounted = 0;

  for (const s of scores) {
    const akaMark = disqualified === 'AKA' ? DQ_MARK_TENTHS : s.aka === null ? null : toTenths(s.aka);
    const aoMark = disqualified === 'AO' ? DQ_MARK_TENTHS : s.ao === null ? null : toTenths(s.ao);
    // No half-votes: a vote counts only when both marks are in.
    if (akaMark === null || aoMark === null) continue;
    judgesCounted += 1;
    akaTenths += akaMark;
    aoTenths += aoMark;
    if (akaMark > aoMark) akaVotes += 1;
    else if (aoMark > akaMark) aoVotes += 1;
    // Exactly equal marks: the judge's pick is indeterminate, so the vote is
    // not counted for either side, but the marks still count toward totals.
  }

  const totals = { aka: akaTenths / 10, ao: aoTenths / 10 };

  if (disqualified !== null) {
    const winner: Side = disqualified === 'AKA' ? 'AO' : 'AKA';
    return {
      winner,
      akaVotes,
      aoVotes,
      akaTotal: totals.aka,
      aoTotal: totals.ao,
      method: 'DISQUALIFICATION',
      judgesCounted,
    };
  }

  if (akaVotes !== aoVotes) {
    const winner: Side = akaVotes > aoVotes ? 'AKA' : 'AO';
    return {
      winner,
      akaVotes,
      aoVotes,
      akaTotal: totals.aka,
      aoTotal: totals.ao,
      method: 'MAJORITY',
      judgesCounted,
    };
  }

  if (akaTenths !== aoTenths) {
    const winner: Side = akaTenths > aoTenths ? 'AKA' : 'AO';
    return {
      winner,
      akaVotes,
      aoVotes,
      akaTotal: totals.aka,
      aoTotal: totals.ao,
      method: 'TOTAL_SCORE_TIEBREAK',
      judgesCounted,
    };
  }

  if (opts.moderatorDecision === 'AKA' || opts.moderatorDecision === 'AO') {
    return {
      winner: opts.moderatorDecision,
      akaVotes,
      aoVotes,
      akaTotal: totals.aka,
      aoTotal: totals.ao,
      method: 'MODERATOR',
      judgesCounted,
    };
  }

  throw new KataDecisionError(
    'Votes and total scores are tied: a moderator decision is required.',
  );
}

/** Result of {@link validateKataRepetition}. */
export interface KataRepetitionCheck {
  ok: boolean;
  reason?: string;
}

const MAX_DISTINCT_KATA = 5; // Art. 5.2.1
const MAX_DISTINCT_KATA_U14 = 4; // Art. 5.2.2
const MAX_PERFORMANCES_PER_KATA = 2; // Art. 5.2.1: never more than twice

/**
 * Validates an athlete's next kata choice against the repetition rules
 * (Art. 5.2.1, 5.2.2), enforced when the kata choice is entered:
 *
 * - the kata must be on the official WKF 1-102 list (number is authoritative);
 * - a kata may never be performed twice in a row;
 * - no kata may be performed more than twice in one event;
 * - at most 5 different kata per event (4 for U14).
 *
 * @param history official kata numbers the athlete has already performed, in
 *   round order.
 * @param nextKata official kata number announced for the upcoming round.
 * @param ageGroup e.g. 'senior', 'U14' (matched case-insensitively).
 */
export function validateKataRepetition(
  history: readonly number[],
  nextKata: number,
  ageGroup: string,
): KataRepetitionCheck {
  if (!Number.isInteger(nextKata) || !isValidKataNumber(nextKata)) {
    return {
      ok: false,
      reason: `Kata "${nextKata}" is not on the official WKF kata list (1-102).`,
    };
  }
  const name = getKataName(nextKata) ?? `#${nextKata}`;

  if (history.length > 0 && history[history.length - 1] === nextKata) {
    return {
      ok: false,
      reason: `Kata ${nextKata} (${name}) cannot be performed twice in a row.`,
    };
  }
  if (history.filter((k) => k === nextKata).length >= MAX_PERFORMANCES_PER_KATA) {
    return {
      ok: false,
      reason: `Kata ${nextKata} (${name}) has already been performed twice in this event.`,
    };
  }
  const maxDistinct =
    ageGroup.toLowerCase() === 'u14' ? MAX_DISTINCT_KATA_U14 : MAX_DISTINCT_KATA;
  const distinct = new Set(history);
  if (!distinct.has(nextKata) && distinct.size >= maxDistinct) {
    return {
      ok: false,
      reason: `Already used ${maxDistinct} different kata in this event (max ${maxDistinct}${
        maxDistinct === MAX_DISTINCT_KATA_U14 ? ' for U14' : ''
      }).`,
    };
  }
  return { ok: true };
}
