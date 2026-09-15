/** A field-level problem found while parsing a protocol message. */
export interface ProtocolIssue {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

/**
 * Thrown when an inbound frame does not match the wire contract.
 *
 * Carries every issue, because a malformed frame is usually a client bug and
 * the fastest way to fix it is to see everything that was wrong at once.
 */
export class ProtocolError extends Error {
  readonly code: string;
  readonly issues: readonly ProtocolIssue[];

  constructor(code: string, message: string, issues: readonly ProtocolIssue[] = []) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.issues = issues;
  }
}
