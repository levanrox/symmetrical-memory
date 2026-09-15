import { describe, expect, it } from 'vitest';
import {
  CATEGORY_STATES,
  categoryMachine,
  DEVICE_STATES,
  deviceMachine,
  MATCH_STATES,
  matchMachine,
  TATAMI_STATES,
  tatamiMachine,
  type CategoryState,
  type DeviceState,
  type MatchState,
  type StateMachine,
  type TatamiState,
} from '../index';

/**
 * Asserts the complete legal/illegal matrix, not just the happy path. `expected`
 * is typed as a total record, so omitting a state is a compile error and the
 * machine can never silently grow a state the tests do not know about.
 */
function assertExhaustiveMatrix<S extends string>(
  machine: StateMachine<S>,
  expected: Readonly<Record<S, readonly S[]>>,
): void {
  expect([...machine.states].sort()).toEqual([...Object.keys(expected)].sort());

  for (const from of machine.states) {
    for (const to of machine.states) {
      const shouldBeLegal = expected[from].includes(to);
      expect(machine.can(from, to), `${from} -> ${to}`).toBe(shouldBeLegal);
    }
  }
}

/** Every declared state must be reachable from the initial state. */
function assertAllStatesReachable<S extends string>(machine: StateMachine<S>): void {
  const seen = new Set<S>([machine.initial]);
  const queue: S[] = [machine.initial];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const next of machine.next(current)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  expect([...seen].sort()).toEqual([...machine.states].sort());
}

describe('category machine', () => {
  it('matches the documented transition matrix exactly', () => {
    assertExhaustiveMatrix<CategoryState>(categoryMachine, {
      CREATED: ['ENTRIES_LOCKED'],
      ENTRIES_LOCKED: ['DRAW_GENERATED', 'CREATED'],
      DRAW_GENERATED: ['DRAW_REVIEW', 'DRAW_GENERATED'],
      DRAW_REVIEW: ['DRAW_FINALIZED', 'DRAW_GENERATED'],
      DRAW_FINALIZED: ['LOCKED', 'DRAW_REVIEW'],
      LOCKED: ['ASSIGNED'],
      ASSIGNED: ['LOADED', 'LOCKED'],
      LOADED: ['LIVE', 'ASSIGNED'],
      LIVE: ['COMPLETED'],
      COMPLETED: ['PUBLISHED'],
      PUBLISHED: [],
    });
  });

  it('keeps the exported state list in sync with the machine', () => {
    expect([...categoryMachine.states].sort()).toEqual([...CATEGORY_STATES].sort());
  });

  it('starts at CREATED and can only reach PUBLISHED through LOCKED', () => {
    expect(categoryMachine.initial).toBe('CREATED');

    // The immutability boundary: no edge leads back into a mutable draw state.
    for (const back of ['DRAW_REVIEW', 'DRAW_GENERATED', 'DRAW_FINALIZED'] as const) {
      expect(categoryMachine.can('LOCKED', back), `LOCKED -> ${back}`).toBe(false);
    }
  });

  it('cannot skip entry lock or the draw states', () => {
    expect(categoryMachine.can('CREATED', 'LOCKED')).toBe(false);
    expect(categoryMachine.can('CREATED', 'DRAW_GENERATED')).toBe(false);
    expect(categoryMachine.can('ENTRIES_LOCKED', 'LOCKED')).toBe(false);
  });

  it('has every state reachable from the initial state', () => {
    assertAllStatesReachable(categoryMachine);
  });
});

describe('match machine', () => {
  it('matches the documented transition matrix exactly', () => {
    assertExhaustiveMatrix<MatchState>(matchMachine, {
      SCHEDULED: ['CALLED', 'VOIDED'],
      CALLED: ['READY', 'VOIDED'],
      READY: ['LIVE', 'VOIDED'],
      LIVE: ['PAUSED', 'FINISHED', 'VOIDED'],
      PAUSED: ['LIVE', 'FINISHED', 'VOIDED'],
      FINISHED: ['CONFIRMED', 'VOIDED'],
      CONFIRMED: ['VOIDED'],
      VOIDED: ['READY'],
    });
  });

  it('keeps the exported state list in sync with the machine', () => {
    expect([...matchMachine.states].sort()).toEqual([...MATCH_STATES].sort());
  });

  it('cannot jump from SCHEDULED straight to LIVE or CONFIRMED', () => {
    expect(matchMachine.can('SCHEDULED', 'LIVE')).toBe(false);
    expect(matchMachine.can('SCHEDULED', 'CONFIRMED')).toBe(false);
    expect(matchMachine.can('SCHEDULED', 'FINISHED')).toBe(false);
  });

  it('allows pausing and resuming a live bout', () => {
    expect(matchMachine.can('LIVE', 'PAUSED')).toBe(true);
    expect(matchMachine.can('PAUSED', 'LIVE')).toBe(true);
  });

  it('allows a confirmed result to be voided and the match re-opened', () => {
    // §16: "wrong winner recorded" must be correctable on the floor.
    expect(matchMachine.can('CONFIRMED', 'VOIDED')).toBe(true);
    expect(matchMachine.can('VOIDED', 'READY')).toBe(true);
  });

  it('has every state reachable from the initial state', () => {
    assertAllStatesReachable(matchMachine);
  });
});

describe('tatami machine', () => {
  it('matches the documented transition matrix exactly', () => {
    assertExhaustiveMatrix<TatamiState>(tatamiMachine, {
      IDLE: ['LOADED', 'OFFLINE'],
      LOADED: ['RUNNING', 'IDLE', 'OFFLINE'],
      RUNNING: ['BREAK', 'DONE', 'OFFLINE'],
      BREAK: ['RUNNING', 'DONE', 'OFFLINE'],
      DONE: ['LOADED', 'OFFLINE'],
      OFFLINE: ['IDLE', 'LOADED'],
    });
  });

  it('keeps the exported state list in sync with the machine', () => {
    expect([...tatamiMachine.states].sort()).toEqual([...TATAMI_STATES].sort());
  });

  it('lets a ring load the next category after finishing one', () => {
    // DONE is per-category, not terminal for the device.
    expect(tatamiMachine.can('DONE', 'LOADED')).toBe(true);
    expect(tatamiMachine.can('DONE', 'RUNNING')).toBe(false);
  });

  it('has every state reachable from the initial state', () => {
    assertAllStatesReachable(tatamiMachine);
  });
});

describe('device machine', () => {
  it('matches the documented transition matrix exactly', () => {
    assertExhaustiveMatrix<DeviceState>(deviceMachine, {
      UNENROLLED: ['ENROLLED'],
      ENROLLED: ['AUTHENTICATED', 'UNENROLLED'],
      AUTHENTICATED: ['ONLINE', 'OFFLINE'],
      ONLINE: ['STALE', 'OFFLINE'],
      STALE: ['ONLINE', 'OFFLINE'],
      OFFLINE: ['ONLINE', 'AUTHENTICATED', 'UNENROLLED'],
    });
  });

  it('keeps the exported state list in sync with the machine', () => {
    expect([...deviceMachine.states].sort()).toEqual([...DEVICE_STATES].sort());
  });

  it('requires enrolment before authentication', () => {
    expect(deviceMachine.can('UNENROLLED', 'AUTHENTICATED')).toBe(false);
    expect(deviceMachine.can('UNENROLLED', 'ONLINE')).toBe(false);
  });

  it('does not un-enrol a device merely because it went offline', () => {
    // Connectivity loss must be distinguishable from "never paired".
    expect(deviceMachine.can('ONLINE', 'OFFLINE')).toBe(true);
    expect(deviceMachine.can('OFFLINE', 'ONLINE')).toBe(true);
    expect(deviceMachine.can('OFFLINE', 'UNENROLLED')).toBe(true);
  });

  it('has every state reachable from the initial state', () => {
    assertAllStatesReachable(deviceMachine);
  });
});
