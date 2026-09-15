import { createStateMachine, type StateMachine } from '../state-machine';

/**
 * Match lifecycle — blueprint §4.5.
 *
 * `VOIDED` is reachable from any live state, including `CONFIRMED`, because a
 * wrongly recorded winner must be correctable on the floor (§16 failure
 * matrix). A voided match re-opens at `READY` so a corrected result can be
 * entered; the original events stay in the log (§7.2).
 */
export const MATCH_STATES = [
  'SCHEDULED',
  'CALLED',
  'READY',
  'LIVE',
  'PAUSED',
  'FINISHED',
  'CONFIRMED',
  'VOIDED',
] as const;

export type MatchState = (typeof MATCH_STATES)[number];

export const matchMachine: StateMachine<MatchState> = createStateMachine<MatchState>({
  initial: 'SCHEDULED',
  transitions: {
    SCHEDULED: ['CALLED', 'VOIDED'],
    CALLED: ['READY', 'VOIDED'],
    READY: ['LIVE', 'VOIDED'],
    LIVE: ['PAUSED', 'FINISHED', 'VOIDED'],
    PAUSED: ['LIVE', 'FINISHED', 'VOIDED'],
    FINISHED: ['CONFIRMED', 'VOIDED'],
    CONFIRMED: ['VOIDED'],
    VOIDED: ['READY'],
  },
});
