import { describe, expect, it } from "vitest";
import { findExact, levenshtein, normalizeName, suggestClosest } from "./match";

describe("levenshtein", () => {
  it("computes known distances", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("kata", "kata")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("kumite", "kumtie")).toBe(2);
  });

  it("is symmetric", () => {
    expect(levenshtein("abc", "abd")).toBe(levenshtein("abd", "abc"));
  });
});

describe("normalizeName", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeName("  Boys  Kumite U12 ")).toBe("boys kumite u12");
    expect(normalizeName(null)).toBe("");
  });
});

describe("findExact", () => {
  const cats = [
    { id: "1", name: "Boys Kumite U12 40kg" },
    { id: "2", name: "Girls Kata U14" },
  ];
  it("matches case- and whitespace-insensitively", () => {
    expect(findExact("boys kumite  u12 40kg", cats)?.id).toBe("1");
    expect(findExact("GIRLS KATA U14", cats)?.id).toBe("2");
  });
  it("returns null when nothing matches", () => {
    expect(findExact("Boys Kumite U13", cats)).toBeNull();
    expect(findExact("", cats)).toBeNull();
  });
});

describe("suggestClosest", () => {
  const cats = [
    { id: "1", name: "Boys Kumite U12 40kg" },
    { id: "2", name: "Boys Kumite U12 45kg" },
    { id: "3", name: "Girls Kata U14" },
  ];
  it("suggests the closest names first", () => {
    const s = suggestClosest("Boys Kumite U12 40 kg", cats, 3);
    expect(s[0].id).toBe("1");
    expect(s[0].distance).toBeLessThanOrEqual(s[1].distance);
  });
  it("drops candidates beyond the distance ceiling", () => {
    const s = suggestClosest("zzz totally different", cats, 3);
    expect(s).toHaveLength(0);
  });
  it("respects the limit", () => {
    const s = suggestClosest("Boys Kumite U12", cats, 1);
    expect(s).toHaveLength(1);
  });
});
