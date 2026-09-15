/** A single field-level problem found while validating a ruleset. */
export interface RulesetIssue {
  /** Dot-joined path to the offending field, e.g. `penalties.escalation`. */
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

/**
 * Thrown when a ruleset fails validation.
 *
 * Carries every issue rather than only the first, so an organiser editing a
 * ruleset sees all of their mistakes in one pass.
 */
export class RulesetValidationError extends Error {
  readonly code = 'INVALID_RULESET';
  readonly issues: readonly RulesetIssue[];

  constructor(issues: readonly RulesetIssue[], rulesetId?: string) {
    const label = rulesetId === undefined ? 'Ruleset' : `Ruleset "${rulesetId}"`;
    super(`${label} is invalid:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'RulesetValidationError';
    this.issues = issues;
  }
}

/** Thrown when a ruleset can be parsed but does not define the requested value. */
export class RulesetLookupError extends Error {
  readonly code = 'RULESET_LOOKUP_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'RulesetLookupError';
  }
}
