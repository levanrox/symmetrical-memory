import type { MatchEvent, MatchEventType } from '@event-suite/protocol';

/**
 * The actions an operator can take back.
 *
 * Deliberately limited to things pressed *during a bout*. A confirmed result has
 * its own, more deliberate path (`RESULT_VOID`) because reversing one moves the
 * whole bracket, and that should not be one stray tap away from the scoring pad.
 */
const UNDOABLE: readonly MatchEventType[] = [
  'SCORE',
  'PENALTY',
  'SENSHU',
  'SENSHU_TORIMASEN',
  'KIKEN',
];

/** Sequences that have already been voided, so they are never undone twice. */
export function voidedSequences(events: readonly MatchEvent[]): ReadonlySet<number> {
  const voided = new Set<number>();

  for (const event of events) {
    if (event.type === 'EVENT_VOID') voided.add(event.payload.targetSeq);
  }

  return voided;
}

/**
 * The most recent action that can still be undone, or null when there is none.
 *
 * Newest first, so repeated undo walks backwards through the bout — which is how
 * a scorer who has just realised they tapped twice expects it to behave.
 */
export function lastUndoableEvent(events: readonly MatchEvent[]): MatchEvent | null {
  const voided = voidedSequences(events);

  for (const event of [...events].reverse()) {
    if (UNDOABLE.includes(event.type) && !voided.has(event.seq)) {
      return event;
    }
  }

  return null;
}

/**
 * A short phrase for an event, in the words an operator would use.
 *
 * Shared so the ring console, the scoreboard and the server's own log all
 * describe a bout the same way.
 */
export function describeEvent(event: MatchEvent): string {
  switch (event.type) {
    case 'SCORE': {
      const { side, value } = event.payload;
      const name = value === 3 ? 'ippon' : value === 2 ? 'waza-ari' : 'yuko';
      return `${side} ${name}`;
    }

    case 'PENALTY':
      return `${event.payload.side} ${event.payload.level.toLowerCase().replace(/_/g, ' ')}`;

    case 'SENSHU':
      return `senshu ${event.payload.side}`;

    case 'SENSHU_TORIMASEN':
      return `senshu ${event.payload.side} annulled`;

    case 'KIKEN':
      return `${event.payload.side} did not appear`;

    case 'MATCH_CALLED':
      return 'called to tatami';
    case 'MATCH_START':
      return 'bout started';
    case 'MATCH_END':
      return 'bout ended';

    case 'RESULT_CONFIRM':
      return `${event.payload.winner} confirmed by ${event.payload.method.toLowerCase()}`;
    case 'RESULT_VOID':
      return 'result reversed';

    case 'CLOCK_START':
    case 'CLOCK_RESUME':
      return 'clock started';
    case 'CLOCK_STOP':
      return 'clock stopped';
    case 'CLOCK_ADJUST':
      return 'clock corrected';

    case 'EVENT_VOID':
      return `undid event ${event.payload.targetSeq}`;

    default:
      return event.type.toLowerCase().replace(/_/g, ' ');
  }
}
