import { describe, expect, it } from "vitest";
import {
  buildSeatTally,
  countCountedVotes,
  decisionMethodLabel,
  formatDecisionLine,
  formatKataMark,
  type SeatTallyInput,
} from "./tally";

function seat(
  seatNumber: number,
  akaTenths: number | null,
  aoTenths: number | null,
  opts?: { judgeName?: string | null; isManual?: boolean }
): SeatTallyInput {
  const manual = opts?.isManual ?? false;
  return {
    seatNumber,
    judgeName:
      opts && "judgeName" in opts ? opts.judgeName ?? null : `Judge ${seatNumber}`,
    aka: akaTenths == null ? null : { tenths: akaTenths, isManual: manual },
    ao: aoTenths == null ? null : { tenths: aoTenths, isManual: manual },
  };
}

describe("formatKataMark", () => {
  it("formats integer tenths as one-decimal marks", () => {
    expect(formatKataMark(85)).toBe("8.5");
    expect(formatKataMark(100)).toBe("10.0");
    expect(formatKataMark(50)).toBe("5.0");
    expect(formatKataMark(77)).toBe("7.7");
  });
});

describe("buildSeatTally", () => {
  it("derives the implied vote from the higher mark", () => {
    const [a, b] = buildSeatTally([seat(1, 85, 82), seat(2, 79, 84)]);
    expect(a.vote).toBe("AKA");
    expect(a.counted).toBe(true);
    expect(b.vote).toBe("AO");
    expect(b.counted).toBe(true);
  });

  it("marks exactly equal marks as EVEN (counted, but no side vote)", () => {
    const [s] = buildSeatTally([seat(1, 83, 83)]);
    expect(s.vote).toBe("EVEN");
    expect(s.counted).toBe(true);
  });

  it("marks half-votes as uncounted with a null vote", () => {
    const [onlyAka, onlyAo, neither] = buildSeatTally([
      seat(1, 85, null),
      seat(2, null, 84),
      seat(3, null, null),
    ]);
    expect(onlyAka.vote).toBeNull();
    expect(onlyAka.counted).toBe(false);
    expect(onlyAo.vote).toBeNull();
    expect(onlyAo.counted).toBe(false);
    expect(neither.vote).toBeNull();
    expect(neither.counted).toBe(false);
  });

  it("sorts by seat number and preserves judge names", () => {
    const tally = buildSeatTally([
      seat(3, 85, 82, { judgeName: "C" }),
      seat(1, 85, 82, { judgeName: "A" }),
      seat(2, 85, 82, { judgeName: null }),
    ]);
    expect(tally.map((s) => s.seatNumber)).toEqual([1, 2, 3]);
    expect(tally[0].judgeName).toBe("A");
    expect(tally[1].judgeName).toBeNull();
    expect(tally[2].judgeName).toBe("C");
  });

  it("does not mutate the input array", () => {
    const input = [seat(2, 85, 82), seat(1, 85, 82)];
    buildSeatTally(input);
    expect(input[0].seatNumber).toBe(2);
  });
});

describe("countCountedVotes", () => {
  it("counts only seats with both marks (EVEN included, half-votes excluded)", () => {
    const tally = buildSeatTally([
      seat(1, 85, 82), // counted
      seat(2, 83, 83), // EVEN: counted
      seat(3, 85, null), // half-vote: not counted
      seat(4, null, null), // empty: not counted
    ]);
    expect(countCountedVotes(tally)).toBe(2);
  });
});

describe("formatDecisionLine", () => {
  it("formats a leader line", () => {
    expect(
      formatDecisionLine({ winner: "AKA", akaVotes: 3, aoVotes: 2, judgesCounted: 5 })
    ).toBe("AKA leads 3–2 · 5 judges in");
    expect(
      formatDecisionLine({ winner: "AO", akaVotes: 1, aoVotes: 4, judgesCounted: 5 })
    ).toBe("AO leads 1–4 · 5 judges in");
  });

  it("formats a tied line", () => {
    expect(
      formatDecisionLine({ winner: null, akaVotes: 2, aoVotes: 2, judgesCounted: 4 })
    ).toBe("Tied 2–2 · 4 judges in");
  });

  it("uses the singular for one judge", () => {
    expect(
      formatDecisionLine({ winner: "AKA", akaVotes: 1, aoVotes: 0, judgesCounted: 1 })
    ).toBe("AKA leads 1–0 · 1 judge in");
  });
});

describe("decisionMethodLabel", () => {
  it("labels the known kata decision methods", () => {
    expect(decisionMethodLabel("KATA_MAJORITY")).toBe("Majority of votes");
    expect(decisionMethodLabel("KATA_TOTAL_SCORE_TIEBREAK")).toBe("Total-score tiebreak");
    expect(decisionMethodLabel("KATA_MODERATOR")).toBe("Moderator decision (Hantei)");
    expect(decisionMethodLabel("KATA_DISQUALIFICATION")).toBe("Disqualification");
  });

  it("passes unknown methods through unchanged", () => {
    expect(decisionMethodLabel("WKF_SOMETHING")).toBe("WKF_SOMETHING");
  });
});
