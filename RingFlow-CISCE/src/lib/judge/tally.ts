/**
 * Kata judge tally view-model helpers (P5) — pure functions, no DB, no Next.js.
 *
 * Bridges the per-seat rows from `getKataBoutTally` (src/actions/judge.ts) to
 * the moderator's kata console: implied per-seat votes, countable-judge
 * counts, and the decision-preview line ("AKA leads 3–2 · 5 judges in").
 */

export type KataSide = "AKA" | "AO";

/** One side's mark on a seat, in integer tenths (85 = 8.5). */
export interface SeatMarkView {
  tenths: number;
  isManual: boolean;
}

/** One per-seat row as returned by `getKataBoutTally`. */
export interface SeatTallyInput {
  seatNumber: number;
  judgeName: string | null;
  aka: SeatMarkView | null;
  ao: SeatMarkView | null;
}

/**
 * The seat's implied vote: the side its judge marked higher.
 * - "EVEN": both marks submitted and exactly equal — the rules engine counts
 *   no vote for either side, but the marks still count toward point totals.
 * - null: at least one mark missing (not a countable vote).
 */
export type SeatVote = "AKA" | "AO" | "EVEN" | null;

export interface SeatTallyView extends SeatTallyInput {
  vote: SeatVote;
  /** True when both marks are in — a countable judge vote. */
  counted: boolean;
}

/** Format integer tenths as a one-decimal mark: 85 -> "8.5". */
export function formatKataMark(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

/** Build the per-seat tally view models, sorted by seat number. */
export function buildSeatTally(
  seats: readonly SeatTallyInput[]
): SeatTallyView[] {
  return [...seats]
    .sort((a, b) => a.seatNumber - b.seatNumber)
    .map((s) => {
      let vote: SeatVote = null;
      if (s.aka && s.ao) {
        vote =
          s.aka.tenths > s.ao.tenths
            ? "AKA"
            : s.ao.tenths > s.aka.tenths
              ? "AO"
              : "EVEN";
      }
      return { ...s, vote, counted: vote !== null };
    });
}

/** How many seats cast a countable vote (both marks submitted). */
export function countCountedVotes(tally: readonly SeatTallyView[]): number {
  return tally.filter((s) => s.counted).length;
}

export interface DecisionLineInput {
  /** null when the vote is tied / undecided. */
  winner: KataSide | null;
  akaVotes: number;
  aoVotes: number;
  judgesCounted: number;
}

/**
 * "AKA leads 3–2 · 5 judges in" / "AO leads 4–1 · 5 judges in" /
 * "Tied 2–2 · 4 judges in".
 */
export function formatDecisionLine(d: DecisionLineInput): string {
  const score = `${d.akaVotes}–${d.aoVotes}`;
  const judges = `${d.judgesCounted} judge${d.judgesCounted === 1 ? "" : "s"} in`;
  if (d.winner === "AKA") return `AKA leads ${score} · ${judges}`;
  if (d.winner === "AO") return `AO leads ${score} · ${judges}`;
  return `Tied ${score} · ${judges}`;
}

/** Human label for a `matches.decision_method` kata value. */
export function decisionMethodLabel(method: string): string {
  switch (method) {
    case "KATA_MAJORITY":
      return "Majority of votes";
    case "KATA_TOTAL_SCORE_TIEBREAK":
      return "Total-score tiebreak";
    case "KATA_MODERATOR":
      return "Moderator decision (Hantei)";
    case "KATA_DISQUALIFICATION":
      return "Disqualification";
    default:
      return method;
  }
}
