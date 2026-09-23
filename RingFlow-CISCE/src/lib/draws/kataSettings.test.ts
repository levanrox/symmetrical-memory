import { describe, expect, it } from "vitest";
import {
  isKataCategoryName,
  isKataDrawFormatValue,
  isKataRankingMethodValue,
  kataDrawFormatLabel,
  kataDrawFormatShortLabel,
  parseKataAdvancePerGroup,
  parseKataDrawFormatLoose,
  parseKataGroupSize,
  parseKataRankingMethodLoose,
  resolveKataDrawFormat,
} from "./kataSettings";

describe("parseKataDrawFormatLoose", () => {
  it.each([
    ["groups", "GROUPS_THEN_ELIMINATION"],
    ["Groups", "GROUPS_THEN_ELIMINATION"],
    ["group", "GROUPS_THEN_ELIMINATION"],
    ["pools", "GROUPS_THEN_ELIMINATION"],
    ["round_robin", "ROUND_ROBIN"],
    ["Round Robin", "ROUND_ROBIN"],
    ["roundrobin", "ROUND_ROBIN"],
    ["league", "ROUND_ROBIN"],
    ["elimination", "SINGLE_ELIM_REPECHAGE"],
    ["knockout", "SINGLE_ELIM_REPECHAGE"],
    ["GROUPS_THEN_ELIMINATION", "GROUPS_THEN_ELIMINATION"],
  ])('"%s" -> %s', (raw, expected) => {
    expect(parseKataDrawFormatLoose(raw)).toEqual({
      value: expected,
      unknown: false,
    });
  });

  it("blank is not unknown", () => {
    expect(parseKataDrawFormatLoose("")).toEqual({ value: null, unknown: false });
    expect(parseKataDrawFormatLoose("   ")).toEqual({
      value: null,
      unknown: false,
    });
  });

  it("flags unknown values instead of coercing", () => {
    expect(parseKataDrawFormatLoose("bogus")).toEqual({
      value: null,
      unknown: true,
    });
  });
});

describe("parseKataRankingMethodLoose", () => {
  it.each([
    ["victory_points", "WKF_VICTORY_POINTS"],
    ["Victory Points", "WKF_VICTORY_POINTS"],
    ["points", "WKF_VICTORY_POINTS"],
    ["total_score", "TOTAL_SCORE"],
    ["Total Score", "TOTAL_SCORE"],
    ["total", "TOTAL_SCORE"],
  ])('"%s" -> %s', (raw, expected) => {
    expect(parseKataRankingMethodLoose(raw)).toEqual({
      value: expected,
      unknown: false,
    });
  });

  it("blank is not unknown; garbage is flagged", () => {
    expect(parseKataRankingMethodLoose("")).toEqual({
      value: null,
      unknown: false,
    });
    expect(parseKataRankingMethodLoose("bogus")).toEqual({
      value: null,
      unknown: true,
    });
  });
});

describe("parseKataAdvancePerGroup / parseKataGroupSize", () => {
  it("blank -> null (engine default)", () => {
    expect(parseKataAdvancePerGroup("")).toBeNull();
    expect(parseKataAdvancePerGroup(null)).toBeNull();
    expect(parseKataGroupSize("")).toBeNull();
    expect(parseKataGroupSize(undefined)).toBeNull();
  });
  it("parses valid numbers", () => {
    expect(parseKataAdvancePerGroup("3")).toBe(3);
    expect(parseKataGroupSize("6")).toBe(6);
  });
  it("clamps out-of-range values instead of rejecting", () => {
    expect(parseKataAdvancePerGroup("99")).toBe(8);
    expect(parseKataAdvancePerGroup("0")).toBe(1);
    expect(parseKataGroupSize("500")).toBe(128);
    expect(parseKataGroupSize("1")).toBe(2);
  });
  it("non-numeric -> null", () => {
    expect(parseKataAdvancePerGroup("abc")).toBeNull();
    expect(parseKataGroupSize("abc")).toBeNull();
  });
});

describe("resolveKataDrawFormat — the regression test for the ignored-format bug", () => {
  it("honours a stored group format on a kata category", () => {
    expect(resolveKataDrawFormat(true, "ROUND_ROBIN")).toBe("ROUND_ROBIN");
    expect(resolveKataDrawFormat(true, "GROUPS_THEN_ELIMINATION")).toBe(
      "GROUPS_THEN_ELIMINATION"
    );
  });
  it("blank/null stored format falls back to single elimination", () => {
    expect(resolveKataDrawFormat(true, null)).toBe("SINGLE_ELIM_REPECHAGE");
    expect(resolveKataDrawFormat(true, "")).toBe("SINGLE_ELIM_REPECHAGE");
    expect(resolveKataDrawFormat(true, undefined)).toBe("SINGLE_ELIM_REPECHAGE");
  });
  it("garbage stored format falls back to single elimination", () => {
    expect(resolveKataDrawFormat(true, "bogus")).toBe("SINGLE_ELIM_REPECHAGE");
  });
  it("non-kata categories always use single elimination, even with a format stored", () => {
    expect(resolveKataDrawFormat(false, "ROUND_ROBIN")).toBe(
      "SINGLE_ELIM_REPECHAGE"
    );
    expect(resolveKataDrawFormat(false, null)).toBe("SINGLE_ELIM_REPECHAGE");
  });
});

describe("isKataCategoryName", () => {
  const defs = [
    { categoryName: "Boys Kata U12", eventType: "kata" },
    { categoryName: "Girls Kumite U14", eventType: "kumite" },
  ];
  it("prefers the explicit definition event type", () => {
    expect(isKataCategoryName("Boys Kata U12", defs)).toBe(true);
    expect(isKataCategoryName("Girls Kumite U14", defs)).toBe(false);
  });
  it("matches definition names case-insensitively", () => {
    expect(isKataCategoryName("boys kata u12", defs)).toBe(true);
  });
  it("falls back to the name-contains-kata check without a definition", () => {
    expect(isKataCategoryName("Senior Kata Open", [])).toBe(true);
    expect(isKataCategoryName("Senior Kumite Open", [])).toBe(false);
  });
});

describe("strict value guards (server action trust boundary)", () => {
  it("accepts only exact enum members", () => {
    expect(isKataDrawFormatValue("ROUND_ROBIN")).toBe(true);
    expect(isKataDrawFormatValue("groups")).toBe(false);
    expect(isKataDrawFormatValue("")).toBe(false);
    expect(isKataRankingMethodValue("TOTAL_SCORE")).toBe(true);
    expect(isKataRankingMethodValue("total_score")).toBe(false);
  });
});

describe("labels", () => {
  it("label falls back to Elimination", () => {
    expect(kataDrawFormatLabel("ROUND_ROBIN")).toBe("Round robin");
    expect(kataDrawFormatLabel(null)).toBe("Elimination");
    expect(kataDrawFormatLabel("bogus")).toBe("Elimination");
  });
  it("short label is null for the default", () => {
    expect(kataDrawFormatShortLabel("GROUPS_THEN_ELIMINATION")).toBe("Groups");
    expect(kataDrawFormatShortLabel("ROUND_ROBIN")).toBe("Round robin");
    expect(kataDrawFormatShortLabel("SINGLE_ELIM_REPECHAGE")).toBeNull();
    expect(kataDrawFormatShortLabel(null)).toBeNull();
  });
});
