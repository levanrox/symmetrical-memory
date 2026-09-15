import type { RulesetInput } from '../schema';

/**
 * WKF Kata Competition Rules, version 2026.00 — valid from 1 January 2026.
 *
 * Kata bouts are decided by majority flag vote (3 or 5 judges) between AKA and AO.
 */
export const WKF_KATA_2026 = {
  id: 'WKF_KATA_2026',
  version: '2026.00',
  source: 'WKF Kata Competition Rules 2026, valid from 1 January 2026',

  durationSeconds: {
    senior: 180,
    u21: 180,
    junior: 180,
    cadet: 180,
    u14: 180,
  },
  durationReductionAllowed: false,
  timeWarningSeconds: 0,

  scoring: { YUKO: 1, WAZA_ARI: 2, IPPON: 3 },
  superiorityMargin: 8,

  decision: {
    senshu: false,
    tieBreakOrder: ['HANTEI'],
  },

  penalties: {
    chuiMax: 3,
    escalation: ['CHUI', 'CHUI', 'CHUI', 'HANSOKU_CHUI', 'HANSOKU'],
    hansokuChuiToHansoku: true,
    shikkaku: true,
    kiken: true,
    hikiwakeAllowedIn: ['ROUND_ROBIN'],
    kikenScoreDefault: { team: '5-0', individualRoundRobin: '5-0' },
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

  weighInToleranceKg: { male: 0, female: 0 },

  formats: ['SINGLE_ELIM_REPECHAGE', 'ROUND_ROBIN', 'POOLS_THEN_ELIM'],
  defaultFormat: 'SINGLE_ELIM_REPECHAGE',

  team: {
    male: { bouts: 1, minPresent: 1, maxSquad: 1 },
    female: { bouts: 1, minPresent: 1, maxSquad: 1 },
    mixed: { allowedBoutCounts: [1], equalGenders: false },
  },

  panelOfficial: {
    referee: 1,
    judges: 4,
    kansa: 1,
    scoreSupervisor: 1,
    videoReviewJudge: 0,
    youthLeagueJudges: 2,
  },
} satisfies RulesetInput;
