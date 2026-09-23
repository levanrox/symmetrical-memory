import type { RulesetInput } from '../schema';

/**
 * WKF Kata Competition Rules, version 2026.00 — valid from 1 January 2026.
 *
 * Individual kata bouts are one-on-one: AKA vs AO, sides allocated by draw,
 * AKA performs first (Art. 3.1.2, 3.1.3, 6.9). Each judge marks each
 * performance 5.0-10.0 in 0.1 steps; a judge's winner pick comes from the
 * relative marks they gave the two sides, and the MAJORITY of votes decides
 * the bout — not point sums (Art. 5.4.1, 5.4.2, 5.5.1, 5.10.1). Flag judging
 * survives only as a manual fallback when the electronic system is
 * unavailable (Art. 5.14), not as the primary decision method.
 *
 * Every value below is transcribed from the rulebook with its Article noted,
 * so a future rules revision can be diffed against this file line by line
 * rather than re-derived from prose. Source of truth:
 * "WKF 2026 Kata Competition Rules, Master Copy".
 */
export const WKF_KATA_2026 = {
  id: 'WKF_KATA_2026',
  version: '2026.00',
  source: 'WKF Kata Competition Rules 2026, valid from 1 January 2026',

  // Kata has no per-group bout duration. The rulebook caps only the Team kata
  // + Bunkai medal performance at 5 minutes total (Art. 5.8.9); transcribed
  // here so durationSeconds carries the only hard time limit the rules give.
  durationSeconds: {
    senior: 300,
    u21: 300,
    junior: 300,
    cadet: 300,
    u14: 300,
  },
  // No duration reduction mechanism exists in the kata rules.
  durationReductionAllowed: false,
  // No "ato shibaraku" warning in kata (the 35 s rule of Art. 6.6 governs
  // starting the performance, not a bout clock).
  timeWarningSeconds: 0,

  // Inert for kata: there are no Yuko/Waza-ari/Ippon values in kata judging.
  // Kata uses per-judge 5.0-10.0 marks (Art. 5.4.1); the shared schema still
  // requires this triple, so it stays as a schema-required placeholder.
  scoring: { YUKO: 1, WAZA_ARI: 2, IPPON: 3 },
  // Inert for kata: no superiority-margin rule exists in the kata rules.
  superiorityMargin: 8,

  decision: {
    // No senshu concept in kata.
    senshu: false,
    // Within-bout tiebreak ladder for tied judge votes (possible with
    // even-sized partial panels): higher total score sum wins, else the
    // moderator/head judge decides (HANTEI). Point sums never decide a bout
    // on their own — they only break a tied vote.
    tieBreakOrder: ['HIGHER_TOTAL_SCORE', 'HANTEI'],
  },

  penalties: {
    // Kata has no CHUI warning system: fouls lower the judge's mark (Art. 5.7)
    // rather than escalating penalties.
    chuiMax: 0,
    escalation: ['HANSOKU', 'SHIKKAKU'],
    hansokuChuiToHansoku: false,
    // Art. 5.8.11 — misconduct / failure to follow the Chief Judge.
    shikkaku: true,
    // Art. 6.4 — failure to appear / withdrawal. The winner of a KIKEN bout
    // is awarded 4 votes (Art. 5.11 note).
    kiken: true,
    // Art. 5.5.2 — no draws are allowed in round-robin; elimination bouts
    // have no draws either, so this stays empty.
    hikiwakeAllowedIn: [],
    kikenScoreDefault: { team: '4 votes', individualRoundRobin: '4 votes' },
  },

  // Notation for the paper record; kata marks are recorded as 5.0-10.0 and
  // the winner by flags/marks, so the kumite technique symbols are unused.
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

  // No weigh-in applies to kata.
  weighInToleranceKg: { male: 0, female: 0 },

  // Art. 3.3.1: (a) elimination with repechage — used unless otherwise
  // specified; (b) round-robin in groups followed by elimination; (c) two-pool
  // round-robin. Pure round-robin is listed for local adaptation (Art. 9).
  formats: ['SINGLE_ELIM_REPECHAGE', 'GROUPS_THEN_ELIMINATION', 'ROUND_ROBIN'],
  defaultFormat: 'SINGLE_ELIM_REPECHAGE',

  // Art. 3.5.1 — kata teams are 3 or 4 athletes, of which 3 perform each
  // round; read `bouts` here as the competing athletes per round.
  team: {
    male: { bouts: 3, minPresent: 3, maxSquad: 4 },
    female: { bouts: 3, minPresent: 3, maxSquad: 4 },
    // Mixed team kata is not contested (Art. 3.3.2: teams are exclusively
    // male or exclusively female); kept inert for the shared schema.
    mixed: { allowedBoutCounts: [1], equalGenders: false },
  },

  // Art. 4.1 — 7 judges for each round of round-robin competition, 5 judges
  // for eliminations; the value below is the elimination default and round-
  // robin rounds use 7. Art. 9 lets local events configure fewer (e.g. 3).
  // There is no referee in kata: the panel is judges plus a Tatami Manager,
  // software technician and announcer (Art. 4.2, 4.4-4.6).
  panelOfficial: {
    referee: 0,
    judges: 5,
    kansa: 0,
    scoreSupervisor: 0,
    videoReviewJudge: 0,
    youthLeagueJudges: 0,
  },
} satisfies RulesetInput;
