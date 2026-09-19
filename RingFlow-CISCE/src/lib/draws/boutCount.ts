import { resolveDraw } from "@/engine/draw-engine/resolution";
import type { DrawGraph } from "@/engine/draw-engine/types";

/**
 * How many bouts a draw actually asks anyone to run.
 *
 * A walkover (one athlete, the other side a bye) and an empty match are decided
 * without a contest, so counting them would leave every progress bar short of
 * 100%. This is the number written to `categories.expected_matches`, and it is
 * deliberately computable from the stored graph alone so the generation path
 * and the backfill path can never drift.
 */
export function foughtBoutCount(graph: DrawGraph): number {
  const resolution = resolveDraw(graph, new Map());
  const neverRun = new Set<string>([
    ...resolution.walkoverMatchIds,
    ...resolution.matches.filter((m) => m.status === "UNRESOLVED").map((m) => m.matchId),
  ]);
  return graph.matches.filter((m) => !neverRun.has(m.id)).length;
}
