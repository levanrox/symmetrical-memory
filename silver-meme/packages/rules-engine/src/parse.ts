import { RulesetValidationError, type RulesetIssue } from './errors';
import { rulesetSchema, type Ruleset } from './schema';

/**
 * Validates an untrusted value into a {@link Ruleset}.
 *
 * Rulesets arrive from three places — source-controlled data, a database row,
 * and eventually an organiser's edit — so this is the single gate they all pass
 * through. It throws every issue at once rather than the first, because an
 * organiser fixing a ruleset should see all their mistakes in one pass.
 */
export function parseRuleset(input: unknown, idHint?: string): Ruleset {
  const result = rulesetSchema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const issues: RulesetIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));

  const id = idHint ?? extractId(input);

  if (id === undefined) {
    throw new RulesetValidationError(issues);
  }

  throw new RulesetValidationError(issues, id);
}

/** Best-effort id extraction so a validation failure can name the ruleset. */
function extractId(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('id' in input)) {
    return undefined;
  }

  const candidate = (input as { id: unknown }).id;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}
