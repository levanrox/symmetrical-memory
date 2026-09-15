import { describe, expect, it } from 'vitest';
import {
  createStateMachine,
  DomainError,
  IllegalTransitionError,
  type StateMachineDefinition,
} from './index';

type S = 'A' | 'B' | 'C';

const machine = createStateMachine<S>({
  initial: 'A',
  transitions: {
    A: ['B'],
    B: ['C', 'A'],
    C: [],
  },
});

describe('createStateMachine', () => {
  it('exposes the declared states and the initial state', () => {
    expect(machine.states).toEqual(['A', 'B', 'C']);
    expect(machine.initial).toBe('A');
  });

  it('reports legal and illegal transitions', () => {
    expect(machine.can('A', 'B')).toBe(true);
    expect(machine.can('B', 'A')).toBe(true);
    expect(machine.can('A', 'C')).toBe(false);
    expect(machine.can('C', 'A')).toBe(false);
    expect(machine.can('A', 'A')).toBe(false);
  });

  it('lists the states reachable in one step', () => {
    expect(machine.next('A')).toEqual(['B']);
    expect(machine.next('B')).toEqual(['C', 'A']);
    expect(machine.next('C')).toEqual([]);
  });

  it('identifies final states', () => {
    expect(machine.isFinal('C')).toBe(true);
    expect(machine.isFinal('A')).toBe(false);
    expect(machine.isFinal('B')).toBe(false);
  });

  it('asserts legal transitions silently', () => {
    expect(() => machine.assert('A', 'B')).not.toThrow();
  });

  it('assert throws an IllegalTransitionError carrying from, to and code', () => {
    try {
      machine.assert('A', 'C');
      expect.unreachable('assert should have thrown for A -> C');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      expect(error).toBeInstanceOf(DomainError);

      const typed = error as IllegalTransitionError<S>;
      expect(typed.code).toBe('ILLEGAL_TRANSITION');
      expect(typed.from).toBe('A');
      expect(typed.to).toBe('C');
      expect(typed.message).toBe('Illegal transition: A -> C');
    }
  });

  it('rejects a definition whose initial state is not declared', () => {
    const broken = {
      initial: 'X',
      transitions: { A: [] },
    } as unknown as StateMachineDefinition<'A'>;

    expect(() => createStateMachine(broken)).toThrow(/Initial state "X" is not declared/);
  });

  it('rejects an empty definition', () => {
    const empty = {
      initial: 'A',
      transitions: {},
    } as unknown as StateMachineDefinition<'A'>;

    expect(() => createStateMachine(empty)).toThrow(/at least one state/);
  });

  it('rejects a transition targeting an undeclared state, at construction time', () => {
    const broken = {
      initial: 'A',
      transitions: { A: ['B'] },
    } as unknown as StateMachineDefinition<'A'>;

    expect(() => createStateMachine(broken)).toThrow(/undeclared state "B"/);
  });

  it('throws rather than returning false for an unknown state', () => {
    const unknown = 'Z' as S;

    expect(machine.can(unknown, 'A')).toBe(false);
    expect(machine.next(unknown)).toEqual([]);
    expect(machine.isFinal(unknown)).toBe(true);
  });
});
