import type { RulesetInput } from '../schema';

/**
 * WKF Kumite Competition Rules, version 2026.00 — valid from 1 January 2026.
 *
 * Every value below is transcribed from the rulebook with its Article noted, so
 * a future rules revision can be diffed against this file line by line rather
 * than re-derived from prose. Source of truth:
 * "WKF 2026 Kumite Competition Rules, Master Copy".
 */
export const WKF_KUMITE_2026 = {
  id: 'WKF_KUMITE_2026',
  version: '2026.00',
  source: 'WKF Kumite Competition Rules 2026, valid from 1 January 2026',

  // Art. 5.1 — effective time per age group, in seconds.
  durationSeconds: {
    senior: 180,
    u21: 180,
    junior: 120,
    cadet: 120,
    u14: 90,
  },
  // Art. 5.2 — organisers may reduce durations for large entry fields, provided
  // it is announced to coaches and officials before the tournament starts.
  durationReductionAllowed: true,
  // Art. 5.4 — the timekeeper's "ato shibaraku" buzzer. Also the window inside
  // which a withdrawn SENSHU cannot be awarded again (Art. 12.2.10).
  timeWarningSeconds: 15,

  // Art. 8.6.
  scoring: { YUKO: 1, WAZA_ARI: 2, IPPON: 3 },
  // Art. 7.7 — an eight-point lead ends the bout.
  superiorityMargin: 8,

  decision: {
    // Art. 12.2.1 — first unopposed score advantage.
    senshu: true,
    // Art. 12.2.3 then Art. 12.2.4.
    tieBreakOrder: ['SENSHU', 'HIGHER_IPPON_COUNT', 'HIGHER_WAZA_ARI_COUNT', 'HANTEI'],
  },

  penalties: {
    // Art. 10.2.1 — CHUI may be given up to three times.
    chuiMax: 3,
    escalation: ['CHUI', 'CHUI', 'CHUI', 'HANSOKU_CHUI', 'HANSOKU'],
    hansokuChuiToHansoku: true,
    // Art. 10.3.1.
    shikkaku: true,
    // Art. 6 — failure to appear.
    kiken: true,
    // Art. 12.2.5 — a tie is only permitted in team or round-robin contexts.
    hikiwakeAllowedIn: ['ROUND_ROBIN', 'TEAM'],
    // Art. 6.2 — a bout not taking place is recorded as 8-0 (team) / 4-0
    // (individual round-robin), counted as YUKO.
    kikenScoreDefault: { team: '8-0', individualRoundRobin: '4-0' },
  },

  // Art. 12.6 — the score supervisor's written notation.
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

  // Art. 3.2.2 d.
  weighInToleranceKg: { male: 0.2, female: 0.5 },

  // Art. 3.4.1.
  formats: ['SINGLE_ELIM_REPECHAGE', 'ROUND_ROBIN', 'POOLS_THEN_ELIM'],
  // Art. 3.4.2.
  defaultFormat: 'SINGLE_ELIM_REPECHAGE',

  // Art. 3.5.
  team: {
    male: { bouts: 5, minPresent: 3, maxSquad: 8 },
    female: { bouts: 3, minPresent: 2, maxSquad: 5 },
    mixed: { allowedBoutCounts: [4, 6], equalGenders: true },
  },

  // Art. 4.1.1, with the reduced panel of Art. 4.5 / Appendix 5 for Youth League.
  panelOfficial: {
    referee: 1,
    judges: 4,
    kansa: 1,
    scoreSupervisor: 1,
    videoReviewJudge: 1,
    youthLeagueJudges: 2,
  },
} satisfies RulesetInput;
