import { matchIdFor, mustGet, roundName, seedPositions, slotIdFor, totalRounds } from './sizing';
import type { MatchNode, Participant, Round, SlotNode } from './types';

export interface BracketBuild {
  matches: MatchNode[];
  slots: SlotNode[];
  rounds: Round[];
}

/**
 * Materialises a single-elimination bracket (blueprint §5.1 step 7).
 *
 * First-round slots are filled from {@link seedPositions}, so a seed number with
 * no corresponding participant becomes a BYE. Because byes are the *highest*
 * seed numbers and the bracket pairs high seeds against low seeds, the byes
 * land on the strongest entrants automatically — no separate pass required.
 *
 * Later rounds are wired by `WINNER_OF` references, which is what makes
 * advancement a graph walk rather than special-case code.
 */
export function buildEliminationBracket(
  categoryId: string,
  participantBySeed: ReadonlyMap<number, Participant>,
  size: number,
): BracketBuild {
  const positions = seedPositions(size);
  const roundsTotal = totalRounds(size);

  const matches: MatchNode[] = [];
  const slots: SlotNode[] = [];
  const rounds: Round[] = [];

  let matchNo = 1;

  // Round 0 — populated from entrants, or left empty as byes.
  const firstRoundMatchCount = size / 2;
  const firstRoundIds: string[] = [];

  for (let index = 0; index < firstRoundMatchCount; index += 1) {
    const matchId = matchIdFor(categoryId, matchNo);

    matches.push({
      id: matchId,
      matchNo,
      roundNo: 0,
      roundName: roundName(firstRoundMatchCount),
      bracketType: 'MAIN',
      poolId: null,
      slotIds: [slotIdFor(matchId, 1), slotIdFor(matchId, 2)],
    });
    firstRoundIds.push(matchId);
    matchNo += 1;

    for (const position of [1, 2] as const) {
      const seedNumber = mustGet(positions, index * 2 + (position - 1), 'seed position');
      const participant = participantBySeed.get(seedNumber);

      slots.push({
        id: slotIdFor(matchId, position),
        matchId,
        position,
        slotType: participant === undefined ? 'BYE' : 'ATHLETE',
        registrationId: participant?.registrationId ?? null,
        sourceMatchId: null,
        repechageRule: null,
      });
    }
  }

  rounds.push({
    roundNo: 0,
    name: roundName(firstRoundMatchCount),
    matchIds: firstRoundIds,
  });

  // Subsequent rounds — each match consumes two winners from the round before.
  let previousRoundIds = firstRoundIds;

  for (let roundNo = 1; roundNo < roundsTotal; roundNo += 1) {
    const matchesInRound = size / 2 ** (roundNo + 1);
    const ids: string[] = [];

    for (let index = 0; index < matchesInRound; index += 1) {
      const matchId = matchIdFor(categoryId, matchNo);

      matches.push({
        id: matchId,
        matchNo,
        roundNo,
        roundName: roundName(matchesInRound),
        bracketType: 'MAIN',
        poolId: null,
        slotIds: [slotIdFor(matchId, 1), slotIdFor(matchId, 2)],
      });
      ids.push(matchId);
      matchNo += 1;

      for (const position of [1, 2] as const) {
        const sourceMatchId = mustGet(
          previousRoundIds,
          index * 2 + (position - 1),
          'source match',
        );

        slots.push({
          id: slotIdFor(matchId, position),
          matchId,
          position,
          slotType: 'WINNER_OF',
          registrationId: null,
          sourceMatchId,
          repechageRule: null,
        });
      }
    }

    rounds.push({ roundNo, name: roundName(matchesInRound), matchIds: ids });
    previousRoundIds = ids;
  }

  return { matches, slots, rounds };
}
