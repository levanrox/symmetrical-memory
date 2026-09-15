import {
  getCategory,
  getDraw,
  getDrawGraph,
  listAssignmentsForTatami,
  listMatchEvents,
  listMatchesForCategory,
  listRegistrations,
  listTatamis,
  type Category,
  type DrawRecord,
  type MatchEventRecord,
  type Pool,
} from '@event-suite/db';
import {
  resolveDraw,
  type MatchOutcome,
  type Podium,
  type ResolutionProblem,
} from '@event-suite/draw-engine';
import type { MatchEvent, MatchEventType, MatchState, Side } from '@event-suite/protocol';
import { getRuleset, matchDurationSeconds, type Ruleset } from '@event-suite/rules-engine';
import {
  describeEvent,
  lastUndoableEvent,
  penaltyProgress,
  proposeOutcome,
  reduceMatch,
  type MatchContext,
  type PenaltyProgress,
  type ProposedOutcome,
} from '@event-suite/scoring';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DATABASE_POOL } from './database';

export interface MatchView {
  matchId: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: string;
  status: string;
  slots: Array<{
    position: number;
    registrationId: string | null;
    sourceMatchId: string | null;
  }>;
  aka: { registrationId: string | null; displayName: string };
  ao: { registrationId: string | null; displayName: string };
  /** Null until the match has events of its own. */
  state: MatchState | null;
  /** What the rules imply, for the console to prefill the result dialog. */
  proposal: ProposedOutcome | null;
  /**
   * Where each athlete stands on the penalty ladder, and what their next
   * penalty would be. Resolved server-side so the console never has to know
   * the sequence.
   */
  penalties: { aka: PenaltyProgress; ao: PenaltyProgress } | null;
  /** The bout so far, oldest first, so a scorer can see what just happened. */
  history: Array<{ seq: number; label: string }>;
  /** What an undo would take back, if anything. */
  undoable: { seq: number; label: string } | null;
}

export interface CategoryView {
  category: Category;
  /** Bout duration for this category's age group (Art. 5.1). */
  durationSeconds: number;
  draw: DrawRecord | null;
  matches: MatchView[];
  readyMatchIds: readonly string[];
  podium: Podium | null;
  problems: readonly ResolutionProblem[];
}

export interface RingQueueView {
  tatamiId: string;
  tatamiName: string;
  categories: CategoryView[];
  /** The match the operator should be running now, if any. */
  currentMatchId: string | null;
}

const UNKNOWN_ATHLETE = { registrationId: null, displayName: '' };

@Injectable()
export class CompetitionService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * The full state of one category: every match, who is in it, what has been
   * scored, and where the bracket has got to.
   */
  async categoryView(categoryId: string): Promise<CategoryView | null> {
    const category = await getCategory(this.pool, categoryId);
    if (category === null) return null;

    const draw = await getDraw(this.pool, categoryId);
    const graph = await getDrawGraph(this.pool, categoryId);

    // The duration is a property of the category, not of its draw, so it is
    // resolved before checking whether a draw exists.
    const durationSeconds = await this.durationFor(category, draw?.rulesetId);

    if (graph === null || draw === null) {
      return {
        category,
        durationSeconds,
        draw: null,
        matches: [],
        readyMatchIds: [],
        podium: null,
        problems: [],
      };
    }

    const ruleset = getRuleset(draw.rulesetId);

    const registrations = await listRegistrations(this.pool, categoryId);
    const nameOf = new Map(registrations.map((registration) => [registration.id, registration.displayName]));

    const stored = await listMatchesForCategory(this.pool, categoryId);

    // Reduce each match's log once. Names are irrelevant to the reducer's
    // verdict, so placeholders are fine here; the real ones are patched in
    // below, once resolution has told us who actually occupies each slot.
    const states = new Map<string, MatchState>();
    const eventsByMatch = new Map<string, MatchEvent[]>();
    const results = new Map<string, MatchOutcome>();

    for (const match of stored) {
      const events = (await listMatchEvents(this.pool, match.id)).map(toMatchEvent);
      if (events.length === 0) continue;

      const slots = graph.slots.filter((slot) => slot.matchId === match.id);
      const context: MatchContext = {
        matchId: match.id,
        durationSeconds,
        ruleset,
        aka: athleteRef(slots.find((slot) => slot.position === 1)?.registrationId ?? null, nameOf),
        ao: athleteRef(slots.find((slot) => slot.position === 2)?.registrationId ?? null, nameOf),
      };

      const { state } = reduceMatch(events, context);

      states.set(match.id, state);
      eventsByMatch.set(match.id, events);

      const outcome = outcomeOf(state);
      if (outcome !== null) results.set(match.id, outcome);
    }

    const resolution = resolveDraw(graph, results);

    const matches: MatchView[] = resolution.matches.map((resolved) => {
      const akaId = resolved.slots.find((slot) => slot.position === 1)?.registrationId ?? null;
      const aoId = resolved.slots.find((slot) => slot.position === 2)?.registrationId ?? null;

      const raw = states.get(resolved.matchId);
      const state =
        raw === undefined ? null : { ...raw, aka: athleteRef(akaId, nameOf), ao: athleteRef(aoId, nameOf) };

      const events = eventsByMatch.get(resolved.matchId) ?? [];
      const undoable = lastUndoableEvent(events);

      return {
        matchId: resolved.matchId,
        matchNo: resolved.matchNo,
        roundNo: resolved.roundNo,
        roundName: resolved.roundName,
        bracketType: resolved.bracketType,
        status: resolved.status,
        slots: resolved.slots.map((slot) => ({
          position: slot.position,
          registrationId: slot.registrationId,
          sourceMatchId: slot.sourceMatchId,
        })),
        aka: athleteRef(akaId, nameOf),
        ao: athleteRef(aoId, nameOf),
        state,
        proposal: state === null ? null : proposeOutcome(state, ruleset),
        penalties: {
          aka: penaltyProgress(state, 'AKA', ruleset),
          ao: penaltyProgress(state, 'AO', ruleset),
        },
        history: events
          .slice(-8)
          .map((event) => ({ seq: event.seq, label: describeEvent(event) })),
        undoable: undoable === null ? null : { seq: undoable.seq, label: describeEvent(undoable) },
      };
    });

    return {
      category,
      durationSeconds,
      draw,
      matches,
      readyMatchIds: resolution.readyMatchIds,
      podium: resolution.podium,
      problems: resolution.problems,
    };
  }

  /**
   * The ruleset governing a match, via its draw or failing that its event.
   *
   * The penalty ladder is read from here, so the console never has to know it.
   */
  async rulesetForMatch(matchId: string): Promise<Ruleset | null> {
    const row = await this.pool.query<{ category_id: string }>(
      'SELECT category_id FROM matches WHERE id = $1',
      [matchId],
    );

    const categoryId = row.rows[0]?.category_id;
    if (categoryId === undefined) return null;

    return this.rulesetForCategory(categoryId);
  }

  private async rulesetForCategory(categoryId: string): Promise<Ruleset> {
    const draw = await getDraw(this.pool, categoryId);
    if (draw !== null) return getRuleset(draw.rulesetId);

    const result = await this.pool.query<{ ruleset_id: string }>(
      `SELECT e.ruleset_id
         FROM events e
         JOIN categories c ON c.event_id = e.id
        WHERE c.id = $1`,
      [categoryId],
    );

    return getRuleset(result.rows[0]?.ruleset_id ?? 'WKF_KUMITE_2026');
  }

  /**
   * Bout duration for a category, before or after a draw exists.
   *
   * Falls back to the event's ruleset, and then to the WKF default, so the ring
   * clock still works on a category that has not been drawn yet.
   */
  private async durationFor(category: Category, drawRulesetId?: string): Promise<number> {
    if (category.discipline === 'TEAM_KATA') {
      return 300;
    }
    if (category.discipline === 'KATA') {
      return 180;
    }
    try {
      const ruleset =
        drawRulesetId === undefined
          ? await this.rulesetForCategory(category.id)
          : getRuleset(drawRulesetId);

      return matchDurationSeconds(ruleset, category.ageGroup);
    } catch {
      return matchDurationSeconds(getRuleset('WKF_KUMITE_2026'), 'senior');
    }
  }

  /** What a ring should be doing: its assigned categories in order. */
  async ringQueue(tatamiId: string): Promise<RingQueueView | null> {
    const assignments = await listAssignmentsForTatami(this.pool, tatamiId);
    if (assignments.length === 0) return null;

    const categories: CategoryView[] = [];
    for (const assignment of assignments) {
      const view = await this.categoryView(assignment.categoryId);
      if (view !== null) categories.push(view);
    }

    const current = categories.find((view) => view.readyMatchIds.length > 0);
    const currentMatchId = current?.readyMatchIds[0] ?? null;

    return {
      tatamiId,
      tatamiName: await this.tatamiName(tatamiId),
      categories,
      currentMatchId,
    };
  }

  /** A single match, with its resolved occupants. */
  async matchView(matchId: string): Promise<MatchView | null> {
    const row = await this.pool.query<{ category_id: string }>(
      'SELECT category_id FROM matches WHERE id = $1',
      [matchId],
    );

    const categoryId = row.rows[0]?.category_id;
    if (categoryId === undefined) return null;

    const view = await this.categoryView(categoryId);
    return view?.matches.find((match) => match.matchId === matchId) ?? null;
  }

  async requireMatchView(matchId: string): Promise<MatchView> {
    const view = await this.matchView(matchId);

    if (view === null) {
      throw new NotFoundException(`unknown match "${matchId}"`);
    }

    return view;
  }

  /** The event a match belongs to, for audit records. */
  async eventIdForCategory(categoryId: string): Promise<string | null> {
    const result = await this.pool.query<{ event_id: string }>(
      'SELECT event_id FROM categories WHERE id = $1',
      [categoryId],
    );

    return result.rows[0]?.event_id ?? null;
  }

  private async tatamiName(tatamiId: string): Promise<string> {
    const result = await this.pool.query<{ name: string }>('SELECT name FROM tatamis WHERE id = $1', [
      tatamiId,
    ]);

    return result.rows[0]?.name ?? 'Tatami';
  }

  /** Tatamis for an event, used by the admin console. */
  async tatamisOf(eventId: string) {
    return listTatamis(this.pool, eventId);
  }
}

/** A command always carries one; this stands in for rows written before that. */
const NIL_UUID = '00000000-0000-7000-8000-000000000000';

/**
 * Maps a stored row back onto the wire event type.
 *
 * The cast is doing real work: `payload` is `jsonb`, so TypeScript cannot know
 * which variant it belongs to. That is safe here because the payload was
 * validated against the same schema on the way in — nothing else writes this
 * table.
 */
function toMatchEvent(record: MatchEventRecord): MatchEvent {
  return {
    matchId: record.matchId,
    seq: record.seq,
    ts: record.ts.getTime(),
    actor: record.actor ?? 'unknown',
    device: record.deviceId ?? 'unknown',
    commandId: record.commandId ?? NIL_UUID,
    type: record.type as MatchEventType,
    payload: record.payload,
  } as MatchEvent;
}

function athleteRef(
  registrationId: string | null,
  nameOf: ReadonlyMap<string, string>,
): { registrationId: string | null; displayName: string } {
  if (registrationId === null) return UNKNOWN_ATHLETE;

  return { registrationId, displayName: nameOf.get(registrationId) ?? 'Unknown athlete' };
}

/** Turns a confirmed match state into the outcome the resolver consumes. */
function outcomeOf(state: MatchState): MatchOutcome | null {
  if (state.status !== 'CONFIRMED' || state.winner === undefined) return null;

  const { side } = state.winner;

  if (side === 'HIKIWAKE') return { kind: 'HIKIWAKE' };

  return { kind: 'WINNER', side: side as Side };
}
