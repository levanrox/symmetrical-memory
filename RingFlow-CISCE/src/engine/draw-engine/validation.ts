import type { Ruleset } from '@event-suite/rules-engine';
import type { DrawInputIssue } from './errors';
import { byeCount } from './sizing';
import type { DrawFormat, DrawInput } from './types';

/**
 * Formats this engine can actually produce.
 *
 * Kept separate from the ruleset's `formats` list: a ruleset may permit a
 * format that is not implemented yet, and it is better to refuse loudly than to
 * emit a bracket that is silently wrong.
 */
export const IMPLEMENTED_FORMATS: readonly DrawFormat[] = ['SINGLE_ELIM_REPECHAGE'];

export const PLANNED_FORMATS: readonly DrawFormat[] = ['ROUND_ROBIN', 'POOLS_THEN_ELIM'];

export function collectInputIssues(input: DrawInput, ruleset: Ruleset): DrawInputIssue[] {
  const issues: DrawInputIssue[] = [];
  const count = input.participants.length;

  if (count === 0) {
    issues.push({
      code: 'NO_PARTICIPANTS',
      path: 'participants',
      message: 'a category needs at least one entrant to be drawn',
    });
  }

  const seen = new Set<string>();
  input.participants.forEach((participant, index) => {
    if (seen.has(participant.registrationId)) {
      issues.push({
        code: 'DUPLICATE_REGISTRATION',
        path: `participants[${index}]`,
        message: `registration "${participant.registrationId}" appears more than once`,
      });
    }
    seen.add(participant.registrationId);
  });

  if (!ruleset.formats.includes(input.format)) {
    issues.push({
      code: 'FORMAT_NOT_ALLOWED',
      path: 'format',
      message: `ruleset "${ruleset.id}" does not permit ${input.format}`,
    });
  }

  if (!IMPLEMENTED_FORMATS.includes(input.format)) {
    issues.push({
      code: 'UNSUPPORTED_FORMAT',
      path: 'format',
      message: `${input.format} is not implemented yet; supported: ${IMPLEMENTED_FORMATS.join(', ')}`,
    });
  }

  if (count > 0 && input.options?.allowByes === false) {
    const byes = byeCount(count);
    if (byes > 0) {
      issues.push({
        code: 'BYES_NOT_ALLOWED',
        path: 'options.allowByes',
        message: `${count} entrants need ${byes} bye(s), but byes were disallowed`,
      });
    }
  }

  if (input.separation?.rule === 'SAME_HALF_BLOCKED') {
    issues.push({
      code: 'UNSUPPORTED_SEPARATION_RULE',
      path: 'separation.rule',
      message:
        'SAME_HALF_BLOCKED is not implemented; use FIRST_ROUND, which separates clashes in the opening round',
    });
  }

  return issues;
}
