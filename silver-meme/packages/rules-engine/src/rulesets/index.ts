import { RulesetLookupError } from '../errors';
import { parseRuleset } from '../parse';
import type { Ruleset, RulesetInput } from '../schema';
import { WKF_KATA_2026 } from './wkf-kata-2026';
import { WKF_KUMITE_2026 } from './wkf-kumite-2026';
import { WKF_TEAM_KATA_2026 } from './wkf-team-kata-2026';
import { WKF_TEAM_KUMITE_2026 } from './wkf-team-kumite-2026';

/**
 * Rulesets shipped with the platform.
 */
export const BUILT_IN_RULESETS: readonly RulesetInput[] = [
  WKF_KUMITE_2026,
  WKF_KATA_2026,
  WKF_TEAM_KATA_2026,
  WKF_TEAM_KUMITE_2026,
];

// Validated once at module load: a malformed built-in ruleset must fail the
// build/test run, never a tournament.
const registry = new Map<string, Ruleset>();

for (const candidate of BUILT_IN_RULESETS) {
  const parsed = parseRuleset(candidate);
  registry.set(parsed.id, parsed);
}

/** Resolves a ruleset by id. Throws {@link RulesetLookupError} when unknown. */
export function getRuleset(id: string): Ruleset {
  const found = registry.get(id);

  if (found === undefined) {
    const known = [...registry.keys()].sort().join(', ');
    throw new RulesetLookupError(`Unknown ruleset "${id}". Known rulesets: ${known}`);
  }

  return found;
}

/** True when a ruleset id is registered, without throwing. */
export function hasRuleset(id: string): boolean {
  return registry.has(id);
}

/** All registered rulesets, sorted by id for stable output. */
export function listRulesets(): readonly Ruleset[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}
