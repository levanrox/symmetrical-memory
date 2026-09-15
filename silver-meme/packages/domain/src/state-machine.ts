import { IllegalTransitionError } from './errors';

/**
 * Declarative definition of a finite state machine.
 *
 * The table is the single source of truth: states are its keys, legal moves are
 * its values. Anything not in the table is illegal by construction, which means
 * adding a state without wiring its edges is impossible.
 */
export interface StateMachineDefinition<S extends string> {
  /** The single starting state. Must be a key of `transitions`. */
  readonly initial: S;
  /** Every state, and the states reachable from it in exactly one step. */
  readonly transitions: Readonly<Record<S, readonly S[]>>;
}

export interface StateMachine<S extends string> {
  /** All declared states. */
  readonly states: readonly S[];
  /** The starting state. */
  readonly initial: S;
  /** True when `from -> to` is a declared edge. */
  can(from: S, to: S): boolean;
  /** Throws {@link IllegalTransitionError} unless `from -> to` is declared. */
  assert(from: S, to: S): void;
  /** The states reachable from `from` in one step. */
  next(from: S): readonly S[];
  /** True when a state has no outgoing edges. */
  isFinal(state: S): boolean;
}

export function createStateMachine<S extends string>(
  definition: StateMachineDefinition<S>,
): StateMachine<S> {
  const { initial, transitions } = definition;
  const states = Object.keys(transitions) as S[];

  if (states.length === 0) {
    throw new Error('State machine must declare at least one state');
  }

  if (!Object.hasOwn(transitions, initial)) {
    throw new Error(`Initial state "${initial}" is not declared in transitions`);
  }

  // Fail fast at construction rather than at the first illegal lookup: a typo in
  // a transition target must never reach runtime.
  for (const from of states) {
    for (const to of transitions[from]) {
      if (!Object.hasOwn(transitions, to)) {
        throw new Error(`Transition ${from} -> ${to} targets an undeclared state "${to}"`);
      }
    }
  }

  const can = (from: S, to: S): boolean =>
    Object.hasOwn(transitions, from) && transitions[from].includes(to);

  return {
    states,
    initial,
    can,
    assert(from: S, to: S): void {
      if (!can(from, to)) {
        throw new IllegalTransitionError(from, to);
      }
    },
    next(from: S): readonly S[] {
      return Object.hasOwn(transitions, from) ? transitions[from] : [];
    },
    isFinal(state: S): boolean {
      return Object.hasOwn(transitions, state) ? transitions[state].length === 0 : true;
    },
  };
}
