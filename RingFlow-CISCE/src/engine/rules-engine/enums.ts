/**
 * Shared vocabulary derived from the WKF Kumite Competition Rules 2026.
 *
 * These are the words the whole platform speaks. Keeping them in one place is
 * what stops a scoring UI, a reducer and a print template from inventing three
 * different spellings of the same concept.
 */

/** Age groups that carry a bout duration (Art. 5.1). */
export const AGE_GROUPS = ['senior', 'u21', 'junior', 'cadet', 'u14'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

/** Bracket / competition formats (Art. 3.4). */
export const COMPETITION_FORMATS = [
  'SINGLE_ELIM_REPECHAGE',
  'ROUND_ROBIN',
  'POOLS_THEN_ELIM',
  'DOUBLE_ELIM',
] as const;
export type CompetitionFormat = (typeof COMPETITION_FORMATS)[number];

/**
 * Where a bout is taking place. Distinct from {@link CompetitionFormat} because
 * a rule can depend on the context rather than the bracket shape — e.g.
 * HIKIWAKE is permitted in round-robin and team contexts, not in individual
 * elimination (Art. 12.2.5).
 */
export const COMPETITION_CONTEXTS = ['INDIVIDUAL_ELIMINATION', 'ROUND_ROBIN', 'TEAM'] as const;
export type CompetitionContext = (typeof COMPETITION_CONTEXTS)[number];

/** Score values (Art. 8.6). */
export const SCORE_TYPES = ['YUKO', 'WAZA_ARI', 'IPPON'] as const;
export type ScoreType = (typeof SCORE_TYPES)[number];

/** Warning and penalty levels (Art. 10). */
export const PENALTY_LEVELS = ['CHUI', 'HANSOKU_CHUI', 'HANSOKU', 'SHIKKAKU'] as const;
export type PenaltyLevel = (typeof PENALTY_LEVELS)[number];

/** Ordered tie-break criteria for an inconclusive bout (Art. 12.2.1, 12.2.3, 12.2.4). */
export const TIE_BREAK_CRITERIA = [
  'SENSHU',
  'HIGHER_IPPON_COUNT',
  'HIGHER_WAZA_ARI_COUNT',
  'HANTEI',
] as const;
export type TieBreakCriterion = (typeof TIE_BREAK_CRITERIA)[number];

/** How a bout was decided (Art. 12.2). */
export const DECISION_METHODS = [
  'POINTS',
  'SENSHU',
  'HANTEI',
  'HANSOKU',
  'SHIKKAKU',
  'KIKEN',
  'HIKIWAKE',
  'FLAGS',
] as const;
export type DecisionMethod = (typeof DECISION_METHODS)[number];

export const DISCIPLINES = ['KUMITE', 'KATA', 'TEAM_KATA', 'TEAM_KUMITE'] as const;
export type Discipline = (typeof DISCIPLINES)[number];


/** Athlete sides as allocated by the draw (Art. 2.2.1 c). */
export const SIDES = ['AKA', 'AO'] as const;
export type Side = (typeof SIDES)[number];

/** Target areas (Art. 8.4). */
export const TARGETS = ['JODAN', 'CHUDAN'] as const;
export type Target = (typeof TARGETS)[number];

/** Technique families, as announced by the referee (Art. 7.6). */
export const TECHNIQUES = ['TSUKI', 'UCHI', 'KERI'] as const;
export type Technique = (typeof TECHNIQUES)[number];
