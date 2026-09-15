import { createStateMachine, type StateMachine } from '../state-machine';

/**
 * Tatami (ring) lifecycle — blueprint §4.5.
 *
 * A ring is `DONE` for a category but returns to `LOADED` when the next
 * assigned category arrives, so `DONE` is a per-category end, not a terminal
 * state for the device.
 */
export const TATAMI_STATES = ['IDLE', 'LOADED', 'RUNNING', 'BREAK', 'DONE', 'OFFLINE'] as const;

export type TatamiState = (typeof TATAMI_STATES)[number];

export const tatamiMachine: StateMachine<TatamiState> = createStateMachine<TatamiState>({
  initial: 'IDLE',
  transitions: {
    IDLE: ['LOADED', 'OFFLINE'],
    LOADED: ['RUNNING', 'IDLE', 'OFFLINE'],
    RUNNING: ['BREAK', 'DONE', 'OFFLINE'],
    BREAK: ['RUNNING', 'DONE', 'OFFLINE'],
    DONE: ['LOADED', 'OFFLINE'],
    OFFLINE: ['IDLE', 'LOADED'],
  },
});
