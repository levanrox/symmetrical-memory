import type { RulesetInput } from '../schema';

/**
 * WKF Team Kumite Competition Rules, version 2026.00 — valid from 1 January 2026.
 *
 * Art. 3.5: Male teams have 5 bouts (squad 5-8, min 3 present);
 * Female teams have 3 bouts (squad 3-5, min 2 present).
 * Individual bouts permit HIKIWAKE (Art. 12.2.5).
 */
export const WKF_TEAM_KUMITE_2026 = {
  id: 'WKF_TEAM_KUMITE_2026',
  version: '2026.00',
  source: 'WKF Team Kumite Competition Rules 2026, valid from 1 January 2026',

  durationSeconds: {
    senior: 180,
    u21: 180,
    junior: 120,
    cadet: 120,
    u14: 90,
  },
  durationReductionAllowed: true,
  timeWarningSeconds: 15,

  scoring: { YUKO: 1, WAZA_ARI: 2, IPPON: 3 },
  superiorityMargin: 8,

  decision: {
    senshu: true,
    tieBreakOrder: ['SENSHU', 'HIGHER_IPPON_COUNT', 'HIGHER_WAZA_ARI_COUNT', 'HANTEI'],
  },

  penalties: {
    chuiMax: 3,
    escalation: ['CHUI', 'CHUI', 'CHUI', 'HANSOKU_CHUI', 'HANSOKU'],
    hansokuChuiToHansoku: true,
    shikkaku: true,
    kiken: true,
    hikiwakeAllowedIn: ['ROUND_ROBIN', 'TEAM'],
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

  formats: ['SINGLE_ELIM_REPECHAGE', 'ROUND_ROBIN', 'POOLS_THEN_ELIM'],
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
} satisfies RulesetInput;
