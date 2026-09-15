import { createStateMachine, type StateMachine } from '../state-machine';

/**
 * Category lifecycle — blueprint §4.5.
 *
 * `LOCKED` is the hard boundary. Up to `DRAW_FINALIZED` a draw may be
 * regenerated or revised (each revision mints a new draw version, §5.4). Once
 * `LOCKED`, the draw is immutable and further changes require an amendment that
 * produces a new version while the category stays locked.
 */
export const CATEGORY_STATES = [
  'CREATED',
  'ENTRIES_LOCKED',
  'DRAW_GENERATED',
  'DRAW_REVIEW',
  'DRAW_FINALIZED',
  'LOCKED',
  'ASSIGNED',
  'LOADED',
  'LIVE',
  'COMPLETED',
  'PUBLISHED',
] as const;

export type CategoryState = (typeof CATEGORY_STATES)[number];

export const categoryMachine: StateMachine<CategoryState> = createStateMachine<CategoryState>({
  initial: 'CREATED',
  transitions: {
    CREATED: ['ENTRIES_LOCKED'],
    // Entry lock may be released before a draw exists.
    ENTRIES_LOCKED: ['DRAW_GENERATED', 'CREATED'],
    // Self-edge = regenerate, which produces a new draw version.
    DRAW_GENERATED: ['DRAW_REVIEW', 'DRAW_GENERATED'],
    DRAW_REVIEW: ['DRAW_FINALIZED', 'DRAW_GENERATED'],
    // Finalising may be undone; locking may not.
    DRAW_FINALIZED: ['LOCKED', 'DRAW_REVIEW'],
    LOCKED: ['ASSIGNED'],
    ASSIGNED: ['LOADED', 'LOCKED'],
    LOADED: ['LIVE', 'ASSIGNED'],
    LIVE: ['COMPLETED'],
    COMPLETED: ['PUBLISHED'],
    PUBLISHED: [],
  },
});
