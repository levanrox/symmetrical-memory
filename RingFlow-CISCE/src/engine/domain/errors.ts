/**
 * Base error for domain rule violations.
 *
 * Every rejection carries a machine-readable `code` so callers (and the API
 * layer) never have to parse a message string.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** Thrown when a state transition is not permitted by the machine's table. */
export class IllegalTransitionError<S extends string> extends DomainError {
  readonly from: S;
  readonly to: S;

  constructor(from: S, to: S) {
    super('ILLEGAL_TRANSITION', `Illegal transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}
