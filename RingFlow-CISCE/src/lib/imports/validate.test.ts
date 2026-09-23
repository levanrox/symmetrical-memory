import { describe, expect, it } from "vitest";
import {
  assignChestNumbers,
  athleteCategoryWarnings,
  athleteTemplateCsv,
  canonicalHeader,
  categoryTemplateCsv,
  checkAthleteFields,
  checkCategoryFields,
  diffRow,
  inferEventType,
  maxNumericChestNumber,
  normalizeSexField,
  parseEventType,
  parseWeightRange,
  tableToFieldRows,
} from "./validate";
import { parseCsvText } from "./csv";

describe("templates", () => {
  it("category template has headers plus one example row", () => {
    const lines = categoryTemplateCsv().split("\n").filter((l) => !l.startsWith("#") && l.trim());
    expect(lines).toHaveLength(2);
    expect(lines[0].split(",")).toContain("name");
    expect(lines[1]).toContain("Boys Kumite U12 40kg");
  });

  it("athlete template lists existing categories as comments", () => {
    const csv = athleteTemplateCsv([{ name: "Girls Kata U14", code: "GKU14" }]);
    expect(csv).toContain("#   - Girls Kata U14  (code: GKU14)");
    const lines = csv.split("\n").filter((l) => !l.startsWith("#") && l.trim());
    expect(lines).toHaveLength(2);
  });
});

describe("canonicalHeader", () => {
  it("maps common aliases", () => {
    expect(canonicalHeader("Category Name")).toBe("name");
    expect(canonicalHeader("chest no")).toBe("chest_number");
    expect(canonicalHeader("Sports ID")).toBe("sports_id");
    expect(canonicalHeader("Gender")).toBe("sex");
    expect(canonicalHeader("Event Type")).toBe("event_type");
  });
  it("falls back to snake_cased header", () => {
    expect(canonicalHeader("My Custom")).toBe("my_custom");
  });
});

describe("tableToFieldRows", () => {
  it("keys rows by canonical header", () => {
    const rows = tableToFieldRows(parseCsvText("Athlete Name,Chest No\nAarav,12"));
    expect(rows[0].fields.name).toBe("Aarav");
    expect(rows[0].fields.chest_number).toBe("12");
    expect(rows[0].rowNumber).toBe(2);
  });
});

describe("normalizeSexField", () => {
  it("normalises variants", () => {
    expect(normalizeSexField("M").value).toBe("M");
    expect(normalizeSexField("boy").value).toBe("M");
    expect(normalizeSexField("Female").value).toBe("F");
    expect(normalizeSexField("any").value).toBeNull();
    expect(normalizeSexField("").value).toBeNull();
  });
  it("flags unknown values", () => {
    expect(normalizeSexField("???").unknown).toBe(true);
  });
});

describe("inferEventType / parseEventType", () => {
  it("infers kata from the name", () => {
    expect(inferEventType("Girls Kata U14")).toBe("kata");
    expect(inferEventType("Boys Kumite U12")).toBe("kumite");
    expect(inferEventType("Team Kata Juniors")).toBe("kata");
  });
  it("parses explicit event types", () => {
    expect(parseEventType("team_kata").value).toBe("team_kata");
    expect(parseEventType("Kumite").value).toBe("kumite");
    expect(parseEventType("").value).toBeNull();
    expect(parseEventType("bogus").unknown).toBe(true);
  });
});

describe("parseWeightRange", () => {
  it("parses range, open and single forms", () => {
    expect(parseWeightRange("35-40 kg")).toEqual({ min: 35, max: 40 });
    expect(parseWeightRange("-40kg")).toEqual({ min: null, max: 40 });
    expect(parseWeightRange("+80 kg")).toEqual({ min: 80, max: null });
    expect(parseWeightRange("60kg")).toEqual({ min: 60, max: 60 });
    expect(parseWeightRange(null)).toBeNull();
    expect(parseWeightRange("open")).toBeNull();
  });
});

describe("checkCategoryFields", () => {
  it("requires a name and validates the age range", () => {
    const r = checkCategoryFields({ name: "", age_min: "14", age_max: "12" });
    expect(r.errors).toContain("name is required");
    expect(r.errors.some((e) => e.includes("greater than"))).toBe(true);
  });
  it("warns on unknown sex/event type instead of erroring", () => {
    const r = checkCategoryFields({ name: "X", sex: "???", event_type: "bogus" });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(2);
    expect(r.fields.sex).toBe("");
  });
  it("flags non-numeric age_min", () => {
    const r = checkCategoryFields({ name: "X", age_min: "ten" });
    expect(r.errors.some((e) => e.includes("age_min"))).toBe(true);
  });
});

describe("checkAthleteFields", () => {
  it("requires name and category/code", () => {
    const r = checkAthleteFields({ name: "", category: "", code: "" });
    expect(r.errors).toContain("name is required");
    expect(r.errors.some((e) => e.includes("category"))).toBe(true);
  });
  it("accepts code alone as the category reference", () => {
    const r = checkAthleteFields({ name: "Aarav", code: "BU12" });
    expect(r.errors).toHaveLength(0);
  });
});

describe("athleteCategoryWarnings", () => {
  const cat = { sex: "M", ageMin: 10, ageMax: 12, weightClass: "35-40 kg", name: "Boys Kumite U12" };
  it("warns on sex mismatch", () => {
    const w = athleteCategoryWarnings({ sex: "F", age: 11, weight: 37, name: "Meera" }, cat);
    expect(w.some((m) => m.includes("sex mismatch"))).toBe(true);
  });
  it("warns on age out of range", () => {
    const w = athleteCategoryWarnings({ sex: "M", age: 14, weight: 37, name: "A" }, cat);
    expect(w.some((m) => m.includes("above the category maximum"))).toBe(true);
  });
  it("warns on weight out of range", () => {
    const w = athleteCategoryWarnings({ sex: "M", age: 11, weight: 50, name: "A" }, cat);
    expect(w.some((m) => m.includes("above the category range"))).toBe(true);
  });
  it("is silent when everything fits", () => {
    const w = athleteCategoryWarnings({ sex: "M", age: 11, weight: 37, name: "A" }, cat);
    expect(w).toHaveLength(0);
  });
  it("never errors on missing data", () => {
    const w = athleteCategoryWarnings(
      { sex: null, age: null, weight: null, name: "A" },
      { sex: null, ageMin: null, ageMax: null, weightClass: null, name: "Open" }
    );
    expect(w).toHaveLength(0);
  });
});

describe("diffRow", () => {
  const map = (field: string, value: string) => {
    if (field === "name") return ["name", value.trim()] as [string, unknown];
    if (field === "nick") return ["nickname", value.trim() || null] as [string, unknown];
    return null;
  };
  it("returns null when nothing changed", () => {
    expect(
      diffRow({ name: "Aarav", nickname: null }, { name: "Aarav", nick: "" }, new Set(["name", "nick"]), map)
    ).toBeNull();
  });
  it("detects changes and ignores columns absent from the file", () => {
    const d = diffRow(
      { name: "Aarav", nickname: "old" },
      { name: "Aarav Sharma" },
      new Set(["name"]),
      map
    );
    expect(d).toEqual({ name: "Aarav Sharma" });
  });
  it("treats null and empty as equal", () => {
    expect(
      diffRow({ nickname: null }, { nick: "" }, new Set(["nick"]), map)
    ).toBeNull();
  });
});

describe("chest numbers", () => {
  it("finds the max numeric chest number, ignoring non-numeric ones", () => {
    expect(maxNumericChestNumber(["3", "12", "A7", null, " 9 "])).toBe(12);
    expect(maxNumericChestNumber([])).toBe(0);
    expect(maxNumericChestNumber(["A1"])).toBe(0);
  });
  it("assigns sequentially after the max", () => {
    expect(assignChestNumbers(["3", "12"], 3)).toEqual(["13", "14", "15"]);
    expect(assignChestNumbers([], 2)).toEqual(["1", "2"]);
  });
});

describe("kata draw settings columns", () => {
  it("canonicalises friendly header spellings", () => {
    expect(canonicalHeader("Draw Format")).toBe("kata_format");
    expect(canonicalHeader("kata format")).toBe("kata_format");
    expect(canonicalHeader("Ranking Method")).toBe("kata_ranking_method");
    expect(canonicalHeader("advance per group")).toBe("kata_advance_per_group");
    expect(canonicalHeader("Group Size")).toBe("kata_group_size");
  });
  it("template documents the kata columns", () => {
    const csv = categoryTemplateCsv();
    expect(csv).toContain("kata_format");
    expect(csv).toContain("kata_ranking_method");
    expect(csv).toContain("kata_advance_per_group");
    expect(csv).toContain("kata_group_size");
  });
  it("normalises kata settings to canonical enum strings", () => {
    const r = checkCategoryFields({
      name: "Boys Kata U12",
      event_type: "kata",
      kata_format: "groups",
      kata_ranking_method: "total score",
      kata_advance_per_group: "3",
      kata_group_size: "6",
    });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.fields.kata_format).toBe("GROUPS_THEN_ELIMINATION");
    expect(r.fields.kata_ranking_method).toBe("TOTAL_SCORE");
    expect(r.fields.kata_advance_per_group).toBe("3");
    expect(r.fields.kata_group_size).toBe("6");
  });
  it("warns (never errors) on unrecognised kata values", () => {
    const r = checkCategoryFields({
      name: "Boys Kata U12",
      kata_format: "bogus",
      kata_ranking_method: "bogus",
      kata_advance_per_group: "lots",
      kata_group_size: "lots",
    });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(4);
    expect(r.fields.kata_format).toBe("");
    expect(r.fields.kata_ranking_method).toBe("");
    expect(r.fields.kata_advance_per_group).toBe("");
    expect(r.fields.kata_group_size).toBe("");
  });
  it("blank kata columns stay blank", () => {
    const r = checkCategoryFields({ name: "Boys Kata U12" });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.fields.kata_format).toBe("");
    expect(r.fields.kata_ranking_method).toBe("");
  });
});
