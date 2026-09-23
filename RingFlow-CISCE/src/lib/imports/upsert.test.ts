import { describe, expect, it } from "vitest";
import {
  planAthleteRow,
  planCategoryRow,
  resolveAthleteCategory,
  seedChestCounters,
  type AthletePlanInput,
  type CategoryPlanInput,
} from "./upsert";
import type { categories, athletes } from "@/db/schema";
import { SKIP_SENTINEL } from "./types";

type CategoryRow = typeof categories.$inferSelect;
type AthleteRow = typeof athletes.$inferSelect;

const T = "tournament-1";

function cat(partial: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: `cat-${Math.random().toString(36).slice(2, 8)}`,
    tournamentId: T,
    name: "Boys Kumite U12 40kg",
    ageBracket: "U12",
    weightClass: "35-40 kg",
    athletesCount: 0,
    expectedMatches: 0,
    hasFullRoster: false,
    belt: null,
    ageMin: 10,
    ageMax: 12,
    sex: "M",
    day: null,
    docUrl: null,
    code: "BU12K40",
    importBatchId: null,
    bronzeMedals: null,
    createdAt: new Date(),
    ...partial,
  };
}

function ath(partial: Partial<AthleteRow> = {}): AthleteRow {
  return {
    id: `ath-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: null,
    tournamentId: T,
    name: "Aarav Sharma",
    chestNumber: null,
    belt: null,
    age: "11",
    sex: "M",
    day: null,
    dojo: null,
    school: "DPS",
    schoolCode: null,
    sportsId: null,
    weight: "38",
    importBatchId: null,
    createdAt: new Date(),
    ...partial,
  };
}

function catInput(
  existing: CategoryRow[],
  locked: string[] = [],
  resolutions?: CategoryPlanInput["resolutions"]
): CategoryPlanInput {
  return { existing, lockedIds: new Set(locked), seenCodes: new Set(), resolutions };
}

const PRESENT_CAT = new Set([
  "name", "code", "event_type", "sex", "age_min", "age_max",
  "age_bracket", "weight_class", "belt", "day", "bronze_medals",
]);

describe("planCategoryRow", () => {
  it("plans create for a new category with inferred event type", () => {
    const row = planCategoryRow(
      2,
      { name: "Girls Kata U14", sex: "F", age_min: "12", age_max: "14" },
      PRESENT_CAT,
      catInput([])
    );
    expect(row.action).toBe("create");
    expect(row.eventType).toBe("kata");
    expect(row.eventTypeInferred).toBe(true);
    expect(row.errors).toHaveLength(0);
  });

  it("infers kumite when the name has no kata", () => {
    const row = planCategoryRow(2, { name: "Boys Kumite U12" }, PRESENT_CAT, catInput([]));
    expect(row.eventType).toBe("kumite");
  });

  it("applies the organiser's event-type override", () => {
    const row = planCategoryRow(
      2,
      { name: "Kata Open" },
      PRESENT_CAT,
      catInput([], [], { eventTypeOverrides: { 2: "team_kata" } })
    );
    expect(row.eventType).toBe("team_kata");
    expect(row.eventTypeInferred).toBe(false);
  });

  it("plans skip when the row matches the stored category exactly", () => {
    const existing = cat();
    const row = planCategoryRow(
      2,
      {
        name: existing.name, code: "BU12K40", sex: "M", age_min: "10", age_max: "12",
        age_bracket: "U12", weight_class: "35-40 kg",
      },
      PRESENT_CAT,
      catInput([existing])
    );
    expect(row.action).toBe("skip");
    expect(row.matchedCategoryId).toBe(existing.id);
  });

  it("plans update when fields differ, with a natural-key drift warning", () => {
    const existing = cat({ sex: "M" });
    const row = planCategoryRow(
      2,
      { name: existing.name, sex: "F" },
      PRESENT_CAT,
      catInput([existing])
    );
    expect(row.action).toBe("update");
    expect(row.warnings.some((w) => w.includes("sex"))).toBe(true);
  });

  it("errors on missing name and duplicate codes within the file", () => {
    const input = catInput([]);
    const r1 = planCategoryRow(2, { name: "", code: "X1" }, PRESENT_CAT, input);
    const r2 = planCategoryRow(3, { name: "A", code: "X1" }, PRESENT_CAT, input);
    expect(r1.action).toBe("error");
    expect(r2.action).toBe("error");
    expect(r2.errors.some((e) => e.includes("more than one row"))).toBe(true);
  });

  it("errors when the code collides with another existing category", () => {
    const existing = cat({ name: "Other", code: "DUP" });
    const row = planCategoryRow(2, { name: "New Cat", code: "DUP" }, PRESENT_CAT, catInput([existing]));
    expect(row.action).toBe("error");
  });

  it("blocks rows for locked draws until unlocked", () => {
    const existing = cat();
    const locked = planCategoryRow(
      2, { name: existing.name, belt: "Black" }, PRESENT_CAT, catInput([existing], [existing.id])
    );
    expect(locked.action).toBe("blocked");
    expect(locked.drawLocked).toBe(true);

    const unlocked = planCategoryRow(
      2, { name: existing.name, belt: "Black" }, PRESENT_CAT,
      catInput([existing], [existing.id], { unlockCategoryIds: [existing.id] })
    );
    expect(unlocked.action).toBe("update");
  });
});

describe("resolveAthleteCategory", () => {
  const cats = [cat({ id: "c1" }), cat({ id: "c2", name: "Girls Kata U14", code: "GKU14" })];

  it("matches by code first", () => {
    const r = resolveAthleteCategory({ code: "gku14", category: "" }, cats);
    expect(r.type).toBe("code");
    expect(r.category?.id).toBe("c2");
  });

  it("falls back to exact name match", () => {
    const r = resolveAthleteCategory({ code: "", category: "girls kata u14" }, cats);
    expect(r.type).toBe("exact");
    expect(r.category?.id).toBe("c2");
  });

  it("returns fuzzy suggestions when nothing matches", () => {
    const r = resolveAthleteCategory({ code: "", category: "Boys Kumite U12 40 kg" }, cats);
    expect(r.type).toBe("none");
    expect(r.category).toBeNull();
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions[0].id).toBe("c1");
  });

  it("honours the organiser's explicit resolution", () => {
    const r = resolveAthleteCategory(
      { code: "", category: "typo name" }, cats, { categoryResolutions: { 5: "c2" } }, 5
    );
    expect(r.type).toBe("resolved");
    expect(r.category?.id).toBe("c2");
  });
});

function athInput(
  categories: CategoryRow[],
  athletesList: AthleteRow[] = [],
  entries: Array<[string, string]> = [],
  resolutions?: AthletePlanInput["resolutions"]
): AthletePlanInput {
  return {
    categories,
    athletes: athletesList,
    entries: new Set(entries.map(([c, a]) => `${c}:${a}`)),
    lockedIds: new Set(),
    chestCounters: new Map(categories.map((c) => [c.id, 1])),
    resolutions,
  };
}

const PRESENT_ATH = new Set([
  "name", "sports_id", "chest_number", "school", "school_code",
  "sex", "age", "weight", "belt", "category", "code",
]);

describe("planAthleteRow", () => {
  it("creates with an auto chest number and sequences across rows", () => {
    const c = cat({ id: "c1" });
    const input = athInput([c], [], []);
    input.chestCounters.set("c1", 13);
    const r1 = planAthleteRow(2, { name: "Aarav", category: c.name }, PRESENT_ATH, input);
    const r2 = planAthleteRow(3, { name: "Vihaan", category: c.name }, PRESENT_ATH, input);
    expect(r1.action).toBe("create");
    expect(r1.chestNumber).toBe("13");
    expect(r1.chestNumberAuto).toBe(true);
    expect(r2.chestNumber).toBe("14");
  });

  it("treats the same name in two categories as two separate creates (no sports_id)", () => {
    const kata = cat({ id: "ck", name: "Boys Kata U12", code: "BK12" });
    const kumite = cat({ id: "cm", name: "Boys Kumite U12", code: "BM12" });
    const r1 = planAthleteRow(2, { name: "Aarav", category: kata.name }, PRESENT_ATH, athInput([kata, kumite]));
    const r2 = planAthleteRow(3, { name: "Aarav", category: kumite.name }, PRESENT_ATH, athInput([kata, kumite]));
    expect(r1.action).toBe("create");
    expect(r2.action).toBe("create");
    expect(r2.warnings.some((w) => w.includes("another category"))).toBe(false); // empty DB: no warning
  });

  it("warns when the same name exists in another category", () => {
    const kata = cat({ id: "ck", name: "Boys Kata U12", code: "BK12" });
    const kumite = cat({ id: "cm", name: "Boys Kumite U12", code: "BM12" });
    const existing = ath({ id: "a1", name: "Aarav", categoryId: "ck" });
    const r = planAthleteRow(
      2, { name: "Aarav", category: kumite.name }, PRESENT_ATH, athInput([kata, kumite], [existing])
    );
    expect(r.action).toBe("create");
    expect(r.warnings.some((w) => w.includes("another category"))).toBe(true);
  });

  it("links rows by sports_id to one athlete record across categories", () => {
    const kata = cat({ id: "ck", name: "Boys Kata U12", code: "BK12" });
    const kumite = cat({ id: "cm", name: "Boys Kumite U12", code: "BM12" });
    const existing = ath({ id: "a1", name: "Aarav", sportsId: "SP-1", categoryId: "ck", chestNumber: "7" });
    const input = athInput([kata, kumite], [existing], [["ck", "a1"]]);
    const r = planAthleteRow(
      2, { name: "Aarav Sharma", sports_id: "SP-1", category: kumite.name }, PRESENT_ATH, input
    );
    expect(r.action).toBe("entry");
    expect(r.matchedAthleteId).toBe("a1");
    expect(r.chestNumber).toBe("7"); // keeps the shared chest number
    expect(r.chestNumberAuto).toBe(false);
  });

  it("is idempotent: identical re-import plans skip", () => {
    const c = cat({ id: "c1" });
    const existing = ath({
      id: "a1", name: "Aarav Sharma", categoryId: "c1", chestNumber: "7",
      school: "DPS", age: "11", sex: "M", weight: "38",
    });
    const input = athInput([c], [existing], [["c1", "a1"]]);
    const r = planAthleteRow(
      2,
      {
        name: "Aarav Sharma", chest_number: "7", school: "DPS", sex: "M",
        age: "11", weight: "38", category: c.name,
      },
      PRESENT_ATH,
      input
    );
    expect(r.action).toBe("skip");
  });

  it("plans update when fields changed on an existing entry", () => {
    const c = cat({ id: "c1" });
    const existing = ath({ id: "a1", name: "Aarav", categoryId: "c1", school: "Old School" });
    const input = athInput([c], [existing], [["c1", "a1"]]);
    const r = planAthleteRow(
      2, { name: "Aarav", school: "New School", category: c.name }, PRESENT_ATH, input
    );
    expect(r.action).toBe("update");
  });

  it("leaves rows unmatched with suggestions when the category is unknown", () => {
    const c = cat({ id: "c1" });
    const r = planAthleteRow(
      2, { name: "Aarav", category: "Boys Kumite U12 40 kg" }, PRESENT_ATH, athInput([c])
    );
    expect(r.action).toBe("unmatched");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it("adds mismatch warnings without erroring", () => {
    const c = cat({ id: "c1" }); // M, 10-12, 35-40kg
    const r = planAthleteRow(
      2, { name: "Meera", sex: "F", age: "16", weight: "55", category: c.name },
      PRESENT_ATH, athInput([c])
    );
    expect(r.action).toBe("create");
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("blocks rows targeting locked categories", () => {
    const c = cat({ id: "c1" });
    const input = athInput([c]);
    input.lockedIds.add("c1");
    const r = planAthleteRow(2, { name: "Aarav", category: c.name }, PRESENT_ATH, input);
    expect(r.action).toBe("blocked");
    expect(r.drawLocked).toBe(true);
  });

  it("errors when name or category is missing", () => {
    const c = cat({ id: "c1" });
    const r = planAthleteRow(2, { name: "", category: "" }, PRESENT_ATH, athInput([c]));
    expect(r.action).toBe("error");
  });

  it("skips rows the organiser explicitly left unmatched", () => {
    const c = cat({ id: "c1" });
    const r = planAthleteRow(
      2,
      { name: "Aarav", category: "Boys Kumite U12 40 kg" },
      PRESENT_ATH,
      athInput([c], [], [], { categoryResolutions: { 2: SKIP_SENTINEL } })
    );
    expect(r.action).toBe("skip");
    expect(r.errors).toHaveLength(0);
  });

  it("resolves an unmatched row to the organiser's chosen category", () => {
    const c = cat({ id: "c1" });
    const r = planAthleteRow(
      2,
      { name: "Aarav", category: "typo name" },
      PRESENT_ATH,
      athInput([c], [], [], { categoryResolutions: { 2: "c1" } })
    );
    expect(r.action).toBe("create");
    expect(r.categoryMatch).toBe("resolved");
    expect(r.matchedCategoryId).toBe("c1");
  });
});

describe("seedChestCounters", () => {
  it("starts after the max numeric chest number per category", () => {
    const c1 = cat({ id: "c1" });
    const c2 = cat({ id: "c2" });
    const a1 = ath({ id: "a1", chestNumber: "12" });
    const a2 = ath({ id: "a2", chestNumber: "A5" });
    const counters = seedChestCounters(
      [c1, c2], [a1, a2],
      [{ categoryId: "c1", athleteId: "a1" }, { categoryId: "c1", athleteId: "a2" }]
    );
    expect(counters.get("c1")).toBe(13);
    expect(counters.get("c2")).toBe(1);
  });
});
