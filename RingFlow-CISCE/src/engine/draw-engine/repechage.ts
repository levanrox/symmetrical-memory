import { matchIdFor, slotIdFor } from './sizing';
import type { MatchNode, SlotNode } from './types';

/** Name of the synthetic round that holds every repechage and bronze match. */
export const REPECHAGE_ROUND_NAME = 'Repechage';

/** How a repechage or bronze slot gets filled at generation time. */
type SlotFiller =
  | { kind: 'BYE' }
  | { kind: 'WINNER_OF'; matchId: string }
  | { kind: 'REPECHAGE'; line: 'A' | 'B'; roundNo: number };

export interface RepechageBuild {
  matches: MatchNode[];
  slots: SlotNode[];
}

/**
 * Builds the repechage ladder for a single-elimination bracket.
 *
 * Karate's default format brings back everyone beaten by the two finalists and
 * awards two bronzes. The shape, per the blueprint:
 *
 *   - each finalist carries a *line*, holding everyone that finalist beat;
 *   - a line is a ladder, earliest loser first, each winner climbing to meet the
 *     next loser, ending at the semifinal loser;
 *   - the top of each ladder takes a bronze.
 *
 * Two structural problems make this lazier than it looks, and both are solved by
 * deferring the binding rather than the shape:
 *
 * 1. **The entrants are unknown until the semifinals end.** A rung is therefore
 *    a REPECHAGE slot carrying the round it draws from; the resolver walks each
 *    finalist's actual path once it exists.
 * 2. **A bye produces no loser.** Rungs are keyed by *round*, so an empty rung
 *    cascades forward as a walkover exactly like a bye in the main bracket —
 *    no special case, and an under-filled category still ends with a medal.
 *
 * `bronzeMedals` is decided before the draw, never after: 2 marks the top of
 * each ladder as a bronze bout, while 1 runs the two ladder winners against each
 * other for a single bronze. The caller never asks for 0 — a category with no
 * bronze is simply not given a repechage at all.
 */
export function buildRepechage(
  categoryId: string,
  options: { roundsTotal: number; bronzeMedals: 1 | 2; firstMatchNo: number },
): RepechageBuild {
  const { roundsTotal, bronzeMedals, firstMatchNo } = options;

  // Rounds played inside one half, which is also the number of rungs per line.
  // A bracket of two has none: no repechage, and no bronze to award.
  const rungsPerLine = roundsTotal - 1;
  if (rungsPerLine < 1) {
    return { matches: [], slots: [] };
  }

  const matches: MatchNode[] = [];
  const slots: SlotNode[] = [];
  let matchNo = firstMatchNo;

  const roundNo = roundsTotal;

  const addMatch = (bracketType: 'REPECHAGE' | 'BRONZE', fillers: [SlotFiller, SlotFiller]): MatchNode => {
    const matchId = matchIdFor(categoryId, matchNo);

    const match: MatchNode = {
      id: matchId,
      matchNo,
      roundNo,
      roundName: REPECHAGE_ROUND_NAME,
      bracketType,
      poolId: null,
      slotIds: [slotIdFor(matchId, 1), slotIdFor(matchId, 2)],
    };

    matches.push(match);

    fillers.forEach((filler, index) => {
      slots.push(toSlot(matchId, (index + 1) as 1 | 2, filler));
    });

    matchNo += 1;
    return match;
  };

  const topOfLine = new Map<'A' | 'B', SlotFiller>();

  for (const line of ['A', 'B'] as const) {
    if (rungsPerLine === 1) {
      // Only one round in the half, so the line holds a single entrant: the
      // semifinal loser, who needs no bout to take a bronze.
      topOfLine.set(line, { kind: 'REPECHAGE', line, roundNo: 0 });
      continue;
    }

    let previous: SlotFiller = { kind: 'REPECHAGE', line, roundNo: 0 };

    for (let rung = 1; rung < rungsPerLine; rung += 1) {
      const isTopOfLadder = rung === rungsPerLine - 1;

      const match = addMatch(isTopOfLadder && bronzeMedals === 2 ? 'BRONZE' : 'REPECHAGE', [
        previous,
        { kind: 'REPECHAGE', line, roundNo: rung },
      ]);

      previous = { kind: 'WINNER_OF', matchId: match.id };
    }

    topOfLine.set(line, previous);
  }

  if (bronzeMedals === 2) {
    if (rungsPerLine === 1) {
      // Each line has one survivor and no natural bout. Modelled as a walkover
      // rather than a special "awarded without fighting" concept, so resolution
      // treats it the same way it treats every other bye.
      addMatch('BRONZE', [mustTop(topOfLine, 'A'), { kind: 'BYE' }]);
      addMatch('BRONZE', [mustTop(topOfLine, 'B'), { kind: 'BYE' }]);
    }
  } else {
    // One bronze: the two lines meet each other.
    addMatch('BRONZE', [mustTop(topOfLine, 'A'), mustTop(topOfLine, 'B')]);
  }

  return { matches, slots };
}

function mustTop(topOfLine: ReadonlyMap<'A' | 'B', SlotFiller>, line: 'A' | 'B'): SlotFiller {
  const filler = topOfLine.get(line);
  if (filler === undefined) {
    throw new Error(`Internal error: no repechage line built for ${line}`);
  }
  return filler;
}

function toSlot(matchId: string, position: 1 | 2, filler: SlotFiller): SlotNode {
  const base = { id: slotIdFor(matchId, position), matchId, position, registrationId: null };

  switch (filler.kind) {
    case 'BYE':
      return { ...base, slotType: 'BYE', sourceMatchId: null, repechageRule: null };

    case 'WINNER_OF':
      return { ...base, slotType: 'WINNER_OF', sourceMatchId: filler.matchId, repechageRule: null };

    case 'REPECHAGE':
      return {
        ...base,
        slotType: 'REPECHAGE',
        sourceMatchId: null,
        repechageRule: { kind: 'LOSERS_TO_FINALIST', line: filler.line, roundNo: filler.roundNo },
      };
  }
}
