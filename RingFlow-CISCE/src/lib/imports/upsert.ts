/**
 * DB layer for the P6 imports (categories + athletes).
 *
 * Two phases, same pure planners:
 *   1. build*Preview — read-only, powers the organiser preview UI.
 *   2. commit*Import  — replays the plan row-by-row inside one batch,
 *      writing import_batches / import_batch_items records for rollback.
 *
 * Natural keys:
 *   categories: (tournamentId, name, sex, ageMin, ageMax)
 *   athletes:   (sports_id) when present, else (tournamentId, name, categoryId)
 *
 * Draw-lock rule: a category whose draw has lockedAt set blocks every
 * import edit until the organiser explicitly unlocks it; unlocking voids
 * the draw (state back to DRAFT, lockedAt cleared, a new draw_versions row
 * records the void with the previous bracket graph preserved).
 */
import { db } from "@/db";
import {
  athletes,
  categories,
  categoryEntries,
  draws,
  drawVersions,
  importBatches,
  importBatchItems,
  matches,
  matchSlots,
  tournamentCategoryDefinitions,
} from "@/db/schema";
import { and, desc, eq, inArray, not, sql } from "drizzle-orm";
import {
  athleteCategoryWarnings,
  checkAthleteFields,
  checkCategoryFields,
  diffRow,
  inferEventType,
  maxNumericChestNumber,
  normalizeSexField,
  parseOptionalNumber,
  type CategoryShape,
  type EventType,
} from "./validate";
import { findExact, normalizeName, suggestClosest } from "./match";
import type {
  AthletePreview,
  AthletePreviewRow,
  CategoryPreview,
  CategoryPreviewRow,
  CategorySuggestion,
  ImportBatchSummary,
  ImportKind,
  ImportResolutions,
  ImportSummary,
  RollbackSummary,
  RowIssue,
} from "./types";
import { SKIP_SENTINEL } from "./types";

/* ------------------------------------------------------------------ */
/* Shared DB reads                                                     */
/* ------------------------------------------------------------------ */

type CategoryRow = typeof categories.$inferSelect;
type AthleteRow = typeof athletes.$inferSelect;

async function loadCategories(tournamentId: string): Promise<CategoryRow[]> {
  return db.select().from(categories).where(eq(categories.tournamentId, tournamentId));
}

async function loadAthletes(tournamentId: string): Promise<AthleteRow[]> {
  return db.select().from(athletes).where(eq(athletes.tournamentId, tournamentId));
}

async function loadEntries(categoryIds: string[]): Promise<{ categoryId: string; athleteId: string }[]> {
  if (categoryIds.length === 0) return [];
  return db
    .select({ categoryId: categoryEntries.categoryId, athleteId: categoryEntries.athleteId })
    .from(categoryEntries)
    .where(inArray(categoryEntries.categoryId, categoryIds));
}

/** Category ids (from the given list) whose draw is currently locked. */
async function loadLockedCategoryIds(categoryIds: string[]): Promise<Set<string>> {
  if (categoryIds.length === 0) return new Set();
  const rows = await db
    .select({ categoryId: draws.categoryId })
    .from(draws)
    .where(
      and(inArray(draws.categoryId, categoryIds), sql`${draws.lockedAt} is not null`)
    );
  return new Set(rows.map((r) => r.categoryId));
}

function toJson(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Category field mapping                                              */
/* ------------------------------------------------------------------ */

function mapCategoryField(
  field: string,
  value: string
): [column: string, dbValue: unknown] | null {
  const empty = value.trim() === "";
  switch (field) {
    case "name":
      return ["name", value.trim()];
    case "code":
      return ["code", empty ? null : value.trim()];
    case "sex":
      return ["sex", empty ? null : value.trim()];
    case "age_min":
      return ["ageMin", empty ? null : Number.parseInt(value, 10)];
    case "age_max":
      return ["ageMax", empty ? null : Number.parseInt(value, 10)];
    case "age_bracket":
      return ["ageBracket", empty ? null : value.trim()];
    case "weight_class":
      return ["weightClass", empty ? null : value.trim()];
    case "belt":
      return ["belt", empty ? null : value.trim()];
    case "day":
      return ["day", empty ? null : value.trim()];
    case "bronze_medals":
      return ["bronzeMedals", empty ? null : Number.parseInt(value, 10)];
    case "kata_format":
      // Already normalised to a canonical enum string (or "") by
      // checkCategoryFields; blank clears back to the default.
      return ["kataFormat", empty ? null : value.trim()];
    case "kata_ranking_method":
      return ["kataRankingMethod", empty ? null : value.trim()];
    case "kata_advance_per_group":
      return ["kataAdvancePerGroup", empty ? null : Number.parseInt(value, 10)];
    case "kata_group_size":
      return ["kataGroupSize", empty ? null : Number.parseInt(value, 10)];
    default:
      return null;
  }
}

const CATEGORY_IMPORTABLE = new Set([
  "name",
  "code",
  "sex",
  "age_min",
  "age_max",
  "age_bracket",
  "weight_class",
  "belt",
  "day",
  "bronze_medals",
  "kata_format",
  "kata_ranking_method",
  "kata_advance_per_group",
  "kata_group_size",
]);

/* ------------------------------------------------------------------ */
/* Category preview (pure planner)                                     */
/* ------------------------------------------------------------------ */

export type CategoryPlanInput = {
  existing: CategoryRow[];
  lockedIds: Set<string>;
  seenCodes: Set<string>;
  resolutions?: ImportResolutions;
};

export function planCategoryRow(
  rowNumber: number,
  rawFields: Record<string, string>,
  presentColumns: Set<string>,
  input: CategoryPlanInput
): CategoryPreviewRow {
  const { fields, errors, warnings } = checkCategoryFields(rawFields);
  const rowErrors = [...errors];
  const rowWarnings = [...warnings];

  const override = input.resolutions?.eventTypeOverrides?.[rowNumber];
  const explicit = fields.event_type as EventType | "";
  const eventType: EventType = override ?? (explicit || inferEventType(fields.name || ""));
  const eventTypeInferred = !override && !explicit;

  // Duplicate code within the file.
  if (fields.code) {
    const codeKey = normalizeName(fields.code);
    if (input.seenCodes.has(codeKey)) {
      rowErrors.push(`code "${fields.code}" is used by more than one row in this file`);
    } else {
      input.seenCodes.add(codeKey);
    }
  }

  let matched: CategoryRow | null = null;
  if (fields.name) {
    matched =
      input.existing.find((c) => normalizeName(c.name) === normalizeName(fields.name)) ?? null;
  }
  // Code collisions against OTHER existing categories are errors.
  if (fields.code && !rowErrors.length) {
    const clash = input.existing.find(
      (c) =>
        c.code &&
        normalizeName(c.code) === normalizeName(fields.code) &&
        (!matched || c.id !== matched.id)
    );
    if (clash) {
      rowErrors.push(`code "${fields.code}" is already used by category "${clash.name}"`);
    }
  }

  const unlockRequested =
    !!matched && !!input.resolutions?.unlockCategoryIds?.includes(matched.id);
  const drawLocked = !!matched && input.lockedIds.has(matched.id) && !unlockRequested;

  let action: CategoryPreviewRow["action"] = "create";
  if (rowErrors.length > 0) {
    action = "error";
  } else if (!matched) {
    action = "create";
  } else if (drawLocked) {
    action = "blocked";
  } else {
    const changes = diffRow(
      matched as unknown as Record<string, unknown>,
      fields,
      new Set([...presentColumns].filter((c) => CATEGORY_IMPORTABLE.has(c))),
      mapCategoryField
    );
    if (!changes) {
      action = "skip";
    } else {
      action = "update";
      // Natural-key drift: same name, different identity fields.
      const drift: string[] = [];
      if (changes.sex !== undefined && String(matched.sex ?? "") !== String(changes.sex ?? "")) drift.push("sex");
      if (changes.ageMin !== undefined) drift.push("age_min");
      if (changes.ageMax !== undefined) drift.push("age_max");
      if (drift.length > 0) {
        rowWarnings.push(
          `matches existing category "${matched.name}" by name but ${drift.join(", ")} differ — the existing category will be updated`
        );
      }
    }
  }

  return {
    row: rowNumber,
    fields,
    action,
    errors: rowErrors,
    warnings: rowWarnings,
    eventType,
    eventTypeInferred,
    matchedCategoryId: matched?.id ?? null,
    matchedCategoryName: matched?.name ?? null,
    drawLocked: !!matched && input.lockedIds.has(matched.id),
  };
}

export async function buildCategoryPreview(
  tournamentId: string,
  fieldRows: { rowNumber: number; fields: Record<string, string> }[],
  presentColumns: Set<string>,
  resolutions?: ImportResolutions
): Promise<CategoryPreview> {
  const existing = await loadCategories(tournamentId);
  const lockedIds = await loadLockedCategoryIds(existing.map((c) => c.id));
  const input: CategoryPlanInput = { existing, lockedIds, seenCodes: new Set(), resolutions };
  const rows = fieldRows.map((r) => planCategoryRow(r.rowNumber, r.fields, presentColumns, input));
  const errors: RowIssue[] = [];
  for (const r of rows) {
    for (const e of r.errors) errors.push({ row: r.row, message: e });
  }
  const lockedCategoryNames: Record<string, string> = {};
  for (const c of existing) {
    if (lockedIds.has(c.id)) lockedCategoryNames[c.id] = c.name;
  }
  return {
    kind: "categories",
    filename: "",
    rows,
    errors,
    lockedCategoryIds: [...lockedIds],
    lockedCategoryNames,
  };
}

/* ------------------------------------------------------------------ */
/* Athlete category resolution                                         */
/* ------------------------------------------------------------------ */

export type CategoryResolution =
  | { type: "code" | "exact" | "resolved"; category: CategoryRow; suggestions: CategorySuggestion[] }
  | { type: "none"; category: null; suggestions: CategorySuggestion[] };

export function resolveAthleteCategory(
  fields: Record<string, string>,
  existing: CategoryRow[],
  resolutions?: ImportResolutions,
  rowNumber?: number
): CategoryResolution {
  // 1. Explicit organiser resolution from the preview UI wins.
  if (rowNumber !== undefined) {
    const chosenId = resolutions?.categoryResolutions?.[rowNumber];
    if (chosenId) {
      const chosen = existing.find((c) => c.id === chosenId) ?? null;
      if (chosen) return { type: "resolved", category: chosen, suggestions: [] };
    }
  }
  // 2. `code` column -> exact code match.
  const code = (fields.code ?? "").trim();
  if (code) {
    const byCode =
      existing.find((c) => c.code && normalizeName(c.code) === normalizeName(code)) ?? null;
    if (byCode) return { type: "code", category: byCode, suggestions: [] };
  }
  // 3. Exact name match on `category` (falling back to the code value).
  const query = (fields.category ?? "").trim() || code;
  const exact = query ? findExact(query, existing) : null;
  if (exact) return { type: "exact", category: exact, suggestions: [] };
  // 4. Fuzzy "did you mean …?" suggestions; row stays unmatched.
  const suggestions: CategorySuggestion[] = query
    ? suggestClosest(query, existing, 3).map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        distance: s.distance,
      }))
    : [];
  return { type: "none", category: null, suggestions };
}

/* ------------------------------------------------------------------ */
/* Athlete field mapping                                               */
/* ------------------------------------------------------------------ */

function mapAthleteField(
  field: string,
  value: string
): [column: string, dbValue: unknown] | null {
  const empty = value.trim() === "";
  switch (field) {
    case "name":
      return ["name", value.trim()];
    case "sports_id":
      return ["sportsId", empty ? null : value.trim()];
    case "chest_number":
      return ["chestNumber", empty ? null : value.trim()];
    case "school":
      return ["school", empty ? null : value.trim()];
    case "school_code":
      return ["schoolCode", empty ? null : value.trim()];
    case "sex":
      return ["sex", empty ? null : value.trim()];
    case "age":
      return ["age", empty ? null : value.trim()];
    case "weight":
      return ["weight", empty ? null : String(parseOptionalNumber(value) ?? "") || null];
    case "belt":
      return ["belt", empty ? null : value.trim()];
    default:
      return null;
  }
}

const ATHLETE_IMPORTABLE = new Set([
  "name",
  "sports_id",
  "chest_number",
  "school",
  "school_code",
  "sex",
  "age",
  "weight",
  "belt",
]);

function categoryShape(c: CategoryRow): CategoryShape {
  return { sex: c.sex, ageMin: c.ageMin, ageMax: c.ageMax, weightClass: c.weightClass, name: c.name };
}

/* ------------------------------------------------------------------ */
/* Athlete preview (pure planner)                                      */
/* ------------------------------------------------------------------ */

export type AthletePlanInput = {
  categories: CategoryRow[];
  athletes: AthleteRow[];
  /** "categoryId:athleteId" pairs that already exist. */
  entries: Set<string>;
  lockedIds: Set<string>;
  /** categoryId -> next chest number to hand out (mutated by the planner). */
  chestCounters: Map<string, number>;
  resolutions?: ImportResolutions;
};

export function seedChestCounters(
  categories: CategoryRow[],
  athletes: AthleteRow[],
  entries: { categoryId: string; athleteId: string }[]
): Map<string, number> {
  const athleteById = new Map(athletes.map((a) => [a.id, a]));
  const perCategory = new Map<string, Array<string | null>>();
  for (const c of categories) perCategory.set(c.id, []);
  // Entries are the source of truth; legacy athletes.categoryId is honoured too.
  for (const e of entries) {
    const a = athleteById.get(e.athleteId);
    if (a) perCategory.get(e.categoryId)?.push(a.chestNumber);
  }
  for (const a of athletes) {
    if (a.categoryId && perCategory.has(a.categoryId)) perCategory.get(a.categoryId)!.push(a.chestNumber);
  }
  const counters = new Map<string, number>();
  for (const [catId, numbers] of perCategory) {
    counters.set(catId, maxNumericChestNumber(numbers) + 1);
  }
  return counters;
}

export function planAthleteRow(
  rowNumber: number,
  rawFields: Record<string, string>,
  presentColumns: Set<string>,
  input: AthletePlanInput
): AthletePreviewRow {
  const { fields, errors, warnings } = checkAthleteFields(rawFields);
  const rowErrors = [...errors];
  const rowWarnings = [...warnings];

  const resolution = resolveAthleteCategory(fields, input.categories, input.resolutions, rowNumber);
  const category = resolution.category;
  const suggestions = resolution.suggestions;

  // Organiser explicitly chose "leave unmatched" in the preview UI.
  const explicitlySkipped =
    rowNumber !== undefined && input.resolutions?.categoryResolutions?.[rowNumber] === SKIP_SENTINEL;
  if (explicitlySkipped) {
    return {
      row: rowNumber,
      fields,
      action: "skip",
      errors: [],
      warnings: ["organiser chose to leave this row unmatched — it will not be imported"],
      categoryMatch: "none",
      matchedCategoryId: null,
      matchedCategoryName: null,
      suggestions,
      matchedAthleteId: null,
      chestNumber: null,
      chestNumberAuto: false,
      drawLocked: false,
    };
  }

  let matchedAthlete: AthleteRow | null = null;
  let entryExists = false;
  let action: AthletePreviewRow["action"] = "unmatched";
  let chestNumber: string | null = fields.chest_number || null;
  let chestNumberAuto = false;

  if (rowErrors.length === 0 && !category) {
    const query = (fields.category || fields.code || "").trim();
    rowErrors.push(
      query
        ? `no category matched "${query}" — pick one from the suggestions or leave the row unimported`
        : "no category given"
    );
    action = "unmatched";
  } else if (rowErrors.length === 0 && category) {
    const unlockRequested = input.resolutions?.unlockCategoryIds?.includes(category.id);
    const drawLocked = input.lockedIds.has(category.id) && !unlockRequested;

    // --- athlete dedupe ---
    if (fields.sports_id) {
      // Global identifier: same sports_id = same athlete record.
      matchedAthlete =
        input.athletes.find(
          (a) => a.sportsId && normalizeName(a.sportsId) === normalizeName(fields.sports_id)
        ) ?? null;
    } else {
      // Natural key (tournament, name, category): same name in another
      // category is a DIFFERENT record — kata + kumite is normal.
      const nameKey = normalizeName(fields.name);
      matchedAthlete =
        input.athletes.find(
          (a) =>
            normalizeName(a.name) === nameKey &&
            (a.categoryId === category.id ||
              input.entries.has(`${category.id}:${a.id}`))
        ) ?? null;
      if (!matchedAthlete) {
        const sameNameElsewhere = input.athletes.find(
          (a) => normalizeName(a.name) === nameKey
        );
        if (sameNameElsewhere) {
          rowWarnings.push(
            `an athlete named "${fields.name}" already exists in another category — a separate record will be created (add sports_id to link them)`
          );
        }
      }
    }

    if (matchedAthlete) {
      entryExists = input.entries.has(`${category.id}:${matchedAthlete.id}`);
    }

    // --- mismatch warnings (never errors) ---
    const probe = {
      sex: normalizeSexField(fields.sex).value,
      age: parseOptionalNumber(fields.age),
      weight: parseOptionalNumber(fields.weight),
      name: fields.name,
    };
    rowWarnings.push(...athleteCategoryWarnings(probe, categoryShape(category)));

    if (drawLocked) {
      action = "blocked";
    } else if (!matchedAthlete) {
      action = "create";
    } else if (!entryExists) {
      action = "entry";
    } else {
      const changes = diffRow(
        matchedAthlete as unknown as Record<string, unknown>,
        fields,
        new Set([...presentColumns].filter((c) => ATHLETE_IMPORTABLE.has(c) && c !== "chest_number")),
        mapAthleteField
      );
      action = changes ? "update" : "skip";
    }

    // --- chest number ---
    if ((action === "create" || action === "entry" || action === "update") && !chestNumber) {
      const existingChest = matchedAthlete?.chestNumber?.trim() || null;
      if (existingChest) {
        chestNumber = existingChest;
      } else {
        const next = input.chestCounters.get(category.id) ?? 1;
        chestNumber = String(next);
        input.chestCounters.set(category.id, next + 1);
        chestNumberAuto = true;
      }
    }
  } else if (rowErrors.length > 0) {
    action = "error";
  }

  return {
    row: rowNumber,
    fields,
    action,
    errors: rowErrors,
    warnings: rowWarnings,
    categoryMatch: resolution.type,
    matchedCategoryId: category?.id ?? null,
    matchedCategoryName: category?.name ?? null,
    suggestions,
    matchedAthleteId: matchedAthlete?.id ?? null,
    chestNumber,
    chestNumberAuto,
    drawLocked: !!category && input.lockedIds.has(category.id),
  };
}

export async function buildAthletePreview(
  tournamentId: string,
  fieldRows: { rowNumber: number; fields: Record<string, string> }[],
  presentColumns: Set<string>,
  resolutions?: ImportResolutions
): Promise<AthletePreview> {
  const cats = await loadCategories(tournamentId);
  const athletesList = await loadAthletes(tournamentId);
  const entryRows = await loadEntries(cats.map((c) => c.id));
  const lockedIds = await loadLockedCategoryIds(cats.map((c) => c.id));
  const input: AthletePlanInput = {
    categories: cats,
    athletes: athletesList,
    entries: new Set(entryRows.map((e) => `${e.categoryId}:${e.athleteId}`)),
    lockedIds,
    chestCounters: seedChestCounters(cats, athletesList, entryRows),
    resolutions,
  };
  const rows = fieldRows.map((r) => planAthleteRow(r.rowNumber, r.fields, presentColumns, input));
  const errors: RowIssue[] = [];
  for (const r of rows) {
    for (const e of r.errors) errors.push({ row: r.row, message: e });
  }
  const lockedCategoryNames: Record<string, string> = {};
  for (const c of cats) {
    if (lockedIds.has(c.id)) lockedCategoryNames[c.id] = c.name;
  }
  return {
    kind: "athletes",
    filename: "",
    rows,
    errors,
    lockedCategoryIds: [...lockedIds],
    lockedCategoryNames,
  };
}

/* ------------------------------------------------------------------ */
/* Draw voiding                                                        */
/* ------------------------------------------------------------------ */

/**
 * Unlock a locked draw because the roster changed underneath it.
 * The draw is NOT deleted: it returns to DRAFT with lockedAt cleared and a
 * new draw_versions row records the void (reason + the bracket graph as it
 * was when locked), so the history stays honest and the draw can be
 * regenerated from the new roster.
 */
export async function voidLockedDraw(categoryId: string, reason: string): Promise<boolean> {
  const [draw] = await db.select().from(draws).where(eq(draws.categoryId, categoryId)).limit(1);
  if (!draw || !draw.lockedAt) return false;

  const [latest] = await db
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(desc(drawVersions.version))
    .limit(1);

  const nextVersion = draw.version + 1;
  await db.insert(drawVersions).values({
    drawId: draw.id,
    version: nextVersion,
    graph: latest?.graph ?? {},
    checksum: `voided:${draw.checksum}`,
    reason,
  });
  await db
    .update(draws)
    .set({ state: "DRAFT", lockedAt: null, version: nextVersion })
    .where(eq(draws.id, draw.id));
  return true;
}

/* ------------------------------------------------------------------ */
/* Commit                                                              */
/* ------------------------------------------------------------------ */

async function recordItem(
  batchId: string,
  entity: "category" | "athlete" | "category_entry",
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) {
  await db
    .insert(importBatchItems)
    .values({ batchId, entity, entityId, before, after })
    .onConflictDoNothing();
}

function buildInsertValues(
  fields: Record<string, string>,
  mapField: (field: string, value: string) => [string, unknown] | null
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    const mapped = mapField(field, value);
    if (mapped) values[mapped[0]] = mapped[1];
  }
  return values;
}

export type CommitInput = {
  tournamentId: string;
  filename: string;
  createdBy: string | null;
  fieldRows: { rowNumber: number; fields: Record<string, string> }[];
  /** Canonical headers present in the uploaded file. */
  presentColumns: string[];
  resolutions?: ImportResolutions;
};

/**
 * M6: persist the import's resolved event type into
 * `tournament_category_definitions` — the table `isKataCategory` prefers
 * over the name fallback. Without this, a category imported as
 * event_type=kata but named e.g. "Forms U12" silently behaves as kumite.
 *
 * - No definition row for (tournament, name) yet: insert one with the
 *   resolved event type (inferred or explicit — it records what the draw
 *   engine would use anyway).
 * - A definition row exists: update its event_type only when the import
 *   EXPLICITLY chose one (preview override dropdown or event_type column).
 *   An inferred type must never clobber an organiser-curated definition.
 * Name matching is case-insensitive, mirroring `isKataCategory`.
 */
async function syncCategoryDefinition(
  tournamentId: string,
  category: {
    name: string;
    sex: string | null;
    ageMin: number | null;
    ageMax: number | null;
  },
  eventType: EventType,
  explicitEventType: boolean
): Promise<void> {
  const rows = await db
    .select({
      id: tournamentCategoryDefinitions.id,
      categoryName: tournamentCategoryDefinitions.categoryName,
      eventType: tournamentCategoryDefinitions.eventType,
    })
    .from(tournamentCategoryDefinitions)
    .where(eq(tournamentCategoryDefinitions.tournamentId, tournamentId));
  const norm = category.name.toLowerCase().trim();
  const existing = rows.find(
    (r) => r.categoryName.toLowerCase().trim() === norm
  );
  if (existing) {
    if (explicitEventType && existing.eventType !== eventType) {
      await db
        .update(tournamentCategoryDefinitions)
        .set({ eventType })
        .where(eq(tournamentCategoryDefinitions.id, existing.id));
    }
    return;
  }
  const sex = (category.sex ?? "").toUpperCase();
  await db.insert(tournamentCategoryDefinitions).values({
    tournamentId,
    categoryName: category.name,
    eventType,
    gender: sex === "M" ? "M" : sex === "F" ? "F" : "any",
    minAge: category.ageMin,
    maxAge: category.ageMax,
  });
}

export async function commitCategoryImport(input: CommitInput): Promise<ImportSummary> {
  const { tournamentId, filename, createdBy, fieldRows, resolutions } = input;
  const present = new Set(input.presentColumns);

  const [batch] = await db
    .insert(importBatches)
    .values({ tournamentId, kind: "categories", filename, createdBy })
    .returning();

  const cats = await loadCategories(tournamentId);
  const lockedIds = await loadLockedCategoryIds(cats.map((c) => c.id));
  const planInput: CategoryPlanInput = {
    existing: [...cats],
    lockedIds,
    seenCodes: new Set(),
    resolutions,
  };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: RowIssue[] = [];
  const voidedDraws: string[] = [];
  const voided = new Set<string>();

  for (const { rowNumber, fields: rawFields } of fieldRows) {
    let plan = planCategoryRow(rowNumber, rawFields, present, planInput);

    if (plan.action === "blocked" && plan.matchedCategoryId) {
      const wantsUnlock = resolutions?.unlockCategoryIds?.includes(plan.matchedCategoryId);
      if (wantsUnlock && !voided.has(plan.matchedCategoryId)) {
        const did = await voidLockedDraw(
          plan.matchedCategoryId,
          `Voided by category import batch ${batch.id}: roster changed after the draw was locked`
        );
        if (did) {
          voided.add(plan.matchedCategoryId);
          voidedDraws.push(plan.matchedCategoryId);
          lockedIds.delete(plan.matchedCategoryId);
          // M1: the first plan pass already recorded this row's code in
          // planInput.seenCodes. Forget it before re-planning, or the
          // in-file duplicate-code guard trips on the row itself and the
          // row is spuriously skipped.
          const recheck = checkCategoryFields(rawFields);
          if (recheck.fields.code) {
            planInput.seenCodes.delete(normalizeName(recheck.fields.code));
          }
          plan = planCategoryRow(rowNumber, rawFields, present, planInput);
        }
      }
    }

    if (plan.action === "error" || plan.action === "blocked") {
      for (const e of plan.errors) errors.push({ row: rowNumber, message: e });
      if (plan.action === "blocked") {
        errors.push({
          row: rowNumber,
          message: `category "${plan.matchedCategoryName}" has a locked draw — unlock it (voiding the draw) to import`,
        });
      }
      continue;
    }
    if (plan.action === "skip") {
      skipped++;
      // M6: a row skipped for "no changes" may still carry an explicit
      // event_type choice from the preview — persist it so the definition
      // table (which drives isKataCategory) doesn't silently disagree.
      const existingRow = planInput.existing.find((c) => c.id === plan.matchedCategoryId);
      if (existingRow) {
        const override = resolutions?.eventTypeOverrides?.[rowNumber];
        const explicitCol = ((plan.fields.event_type as string) ?? "").trim() !== "";
        if (override != null || explicitCol) {
          await syncCategoryDefinition(tournamentId, existingRow, plan.eventType, true);
        }
      }
      continue;
    }

    // M6: the resolved event type (override > explicit column > inference)
    // is persisted per imported category; it is explicit when the organiser
    // chose it in the preview or the file had an event_type column.
    const rowOverride = resolutions?.eventTypeOverrides?.[rowNumber];
    const rowExplicitCol = ((plan.fields.event_type as string) ?? "").trim() !== "";
    const rowExplicit = rowOverride != null || rowExplicitCol;

    if (plan.action === "create") {
      const values = buildInsertValues(plan.fields, mapCategoryField);
      const [inserted] = await db
        .insert(categories)
        .values({
          tournamentId,
          name: String(values.name ?? plan.fields.name),
          importBatchId: batch.id,
          ...(values as Record<string, unknown>),
        })
        .returning();
      await recordItem(batch.id, "category", inserted.id, null, toJson(inserted as unknown as Record<string, unknown>));
      planInput.existing.push(inserted);
      created++;
      await syncCategoryDefinition(tournamentId, inserted, plan.eventType, rowExplicit);
    } else {
      // update
      const matched = planInput.existing.find((c) => c.id === plan.matchedCategoryId)!;
      const changes = diffRow(
        matched as unknown as Record<string, unknown>,
        plan.fields,
        new Set([...present].filter((c) => CATEGORY_IMPORTABLE.has(c))),
        mapCategoryField
      )!;
      const before = toJson(matched as unknown as Record<string, unknown>);
      const [updatedRow] = await db
        .update(categories)
        .set({ ...changes, importBatchId: batch.id })
        .where(eq(categories.id, matched.id))
        .returning();
      await recordItem(
        batch.id,
        "category",
        matched.id,
        before,
        toJson(updatedRow as unknown as Record<string, unknown>)
      );
      Object.assign(matched, updatedRow);
      updated++;
      await syncCategoryDefinition(tournamentId, matched, plan.eventType, rowExplicit);
    }
  }

  await db
    .update(importBatches)
    .set({ rowCounts: { created, updated, skipped, errors: errors.length } })
    .where(eq(importBatches.id, batch.id));

  return { batchId: batch.id, kind: "categories", created, updated, skipped, errors, voidedDraws };
}

export async function commitAthleteImport(input: CommitInput): Promise<ImportSummary> {
  const { tournamentId, filename, createdBy, fieldRows, resolutions } = input;
  const present = new Set(input.presentColumns);

  const [batch] = await db
    .insert(importBatches)
    .values({ tournamentId, kind: "athletes", filename, createdBy })
    .returning();

  const cats = await loadCategories(tournamentId);
  const athletesList = await loadAthletes(tournamentId);
  const entryRows = await loadEntries(cats.map((c) => c.id));
  const lockedIds = await loadLockedCategoryIds(cats.map((c) => c.id));

  const planInput: AthletePlanInput = {
    categories: cats,
    athletes: [...athletesList],
    entries: new Set(entryRows.map((e) => `${e.categoryId}:${e.athleteId}`)),
    lockedIds,
    chestCounters: seedChestCounters(cats, athletesList, entryRows),
    resolutions,
  };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: RowIssue[] = [];
  const voidedDraws: string[] = [];
  const voided = new Set<string>();
  const touchedCategories = new Set<string>();

  for (const { rowNumber, fields: rawFields } of fieldRows) {
    let plan = planAthleteRow(rowNumber, rawFields, present, planInput);

    if (plan.action === "blocked" && plan.matchedCategoryId) {
      const wantsUnlock = resolutions?.unlockCategoryIds?.includes(plan.matchedCategoryId);
      if (wantsUnlock && !voided.has(plan.matchedCategoryId)) {
        const did = await voidLockedDraw(
          plan.matchedCategoryId,
          `Voided by athlete import batch ${batch.id}: roster changed after the draw was locked`
        );
        if (did) {
          voided.add(plan.matchedCategoryId);
          voidedDraws.push(plan.matchedCategoryId);
          lockedIds.delete(plan.matchedCategoryId);
          plan = planAthleteRow(rowNumber, rawFields, present, planInput);
        }
      }
    }

    if (
      plan.action === "error" ||
      plan.action === "blocked" ||
      plan.action === "unmatched"
    ) {
      for (const e of plan.errors) errors.push({ row: rowNumber, message: e });
      if (plan.action === "blocked") {
        errors.push({
          row: rowNumber,
          message: `category "${plan.matchedCategoryName}" has a locked draw — unlock it (voiding the draw) to import`,
        });
      }
      continue;
    }
    if (plan.action === "skip") {
      skipped++;
      continue;
    }

    const categoryId = plan.matchedCategoryId!;
    touchedCategories.add(categoryId);

    // --- athlete upsert ---
    let athleteId = plan.matchedAthleteId;
    if (plan.action === "create") {
      const values = buildInsertValues(plan.fields, mapAthleteField);
      if (plan.chestNumber) values.chestNumber = plan.chestNumber;
      const [inserted] = await db
        .insert(athletes)
        .values({
          tournamentId,
          categoryId,
          name: String(values.name ?? plan.fields.name),
          importBatchId: batch.id,
          ...(values as Record<string, unknown>),
        })
        .returning();
      await recordItem(batch.id, "athlete", inserted.id, null, toJson(inserted as unknown as Record<string, unknown>));
      planInput.athletes.push(inserted);
      athleteId = inserted.id;
      created++;
    } else {
      const matched = planInput.athletes.find((a) => a.id === athleteId)!;
      const changes = diffRow(
        matched as unknown as Record<string, unknown>,
        plan.fields,
        new Set([...present].filter((c) => ATHLETE_IMPORTABLE.has(c))),
        mapAthleteField
      );
      const merged: Record<string, unknown> = { ...(changes ?? {}) };
      // Adopt the planned chest number when the athlete has none.
      if (!matched.chestNumber?.trim() && plan.chestNumber) {
        merged.chestNumber = plan.chestNumber;
      }
      if (Object.keys(merged).length > 0) {
        const before = toJson(matched as unknown as Record<string, unknown>);
        const [updatedRow] = await db
          .update(athletes)
          .set({ ...merged, importBatchId: batch.id })
          .where(eq(athletes.id, matched.id))
          .returning();
        await recordItem(
          batch.id,
          "athlete",
          matched.id,
          before,
          toJson(updatedRow as unknown as Record<string, unknown>)
        );
        Object.assign(matched, updatedRow);
        updated++;
      }
    }

    // --- category entry (idempotent: unique on categoryId+athleteId) ---
    const entryKey = `${categoryId}:${athleteId}`;
    if (!planInput.entries.has(entryKey)) {
      const [entry] = await db
        .insert(categoryEntries)
        .values({ categoryId, athleteId: athleteId!, importBatchId: batch.id })
        .onConflictDoNothing()
        .returning();
      if (entry) {
        await recordItem(batch.id, "category_entry", entry.id, null, toJson(entry as unknown as Record<string, unknown>));
      }
      planInput.entries.add(entryKey);
    }
  }

  // Refresh the cached entrant counts on touched categories.
  for (const catId of touchedCategories) {
    const count = [...planInput.entries].filter((k) => k.startsWith(`${catId}:`)).length;
    await db
      .update(categories)
      .set({ athletesCount: count })
      .where(eq(categories.id, catId));
  }

  await db
    .update(importBatches)
    .set({ rowCounts: { created, updated, skipped, errors: errors.length } })
    .where(eq(importBatches.id, batch.id));

  return { batchId: batch.id, kind: "athletes", created, updated, skipped, errors, voidedDraws };
}

/* ------------------------------------------------------------------ */
/* History + rollback                                                  */
/* ------------------------------------------------------------------ */

export async function listImportBatches(tournamentId: string): Promise<ImportBatchSummary[]> {
  const rows = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.tournamentId, tournamentId))
    .orderBy(desc(importBatches.createdAt));
  return rows.map((b) => ({
    id: b.id,
    kind: b.kind as ImportKind,
    filename: b.filename,
    rowCounts: (b.rowCounts as ImportBatchSummary["rowCounts"]) ?? {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    },
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
    rolledBackAt: b.rolledBackAt ? b.rolledBackAt.toISOString() : null,
  }));
}

const ENTITY_TABLE = {
  category: categories,
  athlete: athletes,
  category_entry: categoryEntries,
} as const;

/**
 * Roll back one import batch: delete rows it created (entries first, then
 * athletes, then categories, so FKs stay happy) and restore the before-image
 * of rows it updated. The batch itself is kept and stamped rolledBackAt.
 *
 * P9 M-3 safety:
 * (a) Before deleting anything, created athletes/categories are checked for
 *     references in matchSlots / matches / draws (and for category entries
 *     NOT created by this batch). If any exist, the rollback is REFUSED with
 *     an error listing the blockers — deleting would otherwise corrupt draws
 *     (phantom byes via `set null`, or cascade-deleted matches/draws).
 * (b) The whole rollback runs inside a single DB transaction: either every
 *     delete/restore/refresh lands, or none does.
 * (c) `categories.athletesCount` is refreshed for every category that lost
 *     entries, so the cached counts never go stale after a rollback.
 */
export async function rollbackImportBatch(
  tournamentId: string,
  batchId: string
): Promise<RollbackSummary> {
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.tournamentId, tournamentId)))
    .limit(1);
  if (!batch) throw new Error("Import batch not found");
  if (batch.rolledBackAt) throw new Error("This batch was already rolled back");

  const items = await db
    .select()
    .from(importBatchItems)
    .where(eq(importBatchItems.batchId, batchId));

  const createdAthleteIds = items
    .filter((i) => i.entity === "athlete" && i.before === null)
    .map((i) => i.entityId);
  const createdCategoryIds = items
    .filter((i) => i.entity === "category" && i.before === null)
    .map((i) => i.entityId);
  const createdEntryIds = items
    .filter((i) => i.entity === "category_entry" && i.before === null)
    .map((i) => i.entityId);

  return db.transaction(async (tx) => {
    // ---- (a) Reference check: refuse when created rows are in use ---------
    const blockers: string[] = [];
    if (createdAthleteIds.length > 0) {
      const nameRows = await tx
        .select({ id: athletes.id, name: athletes.name })
        .from(athletes)
        .where(inArray(athletes.id, createdAthleteIds));
      const names = new Map(nameRows.map((r) => [r.id, r.name]));

      // matchSlots.athleteId is ON DELETE SET NULL: deleting would leave
      // phantom byes in someone's draw.
      const slotted = await tx
        .select({ matchId: matchSlots.matchId, athleteId: matchSlots.athleteId })
        .from(matchSlots)
        .where(inArray(matchSlots.athleteId, createdAthleteIds));
      const slottedByAthlete = new Map<string, string[]>();
      for (const s of slotted) {
        if (!s.athleteId) continue;
        const list = slottedByAthlete.get(s.athleteId) ?? [];
        list.push(s.matchId);
        slottedByAthlete.set(s.athleteId, list);
      }
      for (const [athleteId, matchIds] of slottedByAthlete) {
        blockers.push(
          `athlete "${names.get(athleteId) ?? athleteId}" is slotted in match(es): ${matchIds.join(", ")}`
        );
      }

      // matches.winnerId is ON DELETE SET NULL: deleting would erase winners.
      const won = await tx
        .select({ id: matches.id, winnerId: matches.winnerId })
        .from(matches)
        .where(inArray(matches.winnerId, createdAthleteIds));
      const wonByAthlete = new Map<string, string[]>();
      for (const m of won) {
        if (!m.winnerId) continue;
        const list = wonByAthlete.get(m.winnerId) ?? [];
        list.push(m.id);
        wonByAthlete.set(m.winnerId, list);
      }
      for (const [athleteId, matchIds] of wonByAthlete) {
        blockers.push(
          `athlete "${names.get(athleteId) ?? athleteId}" is recorded as winner of match(es): ${matchIds.join(", ")}`
        );
      }

      // Entries NOT created by this batch would be cascade-deleted with the
      // athlete (categoryEntries.athleteId is ON DELETE CASCADE).
      const strayEntries =
        createdEntryIds.length > 0
          ? await tx
              .select({ athleteId: categoryEntries.athleteId })
              .from(categoryEntries)
              .where(
                and(
                  inArray(categoryEntries.athleteId, createdAthleteIds),
                  not(inArray(categoryEntries.id, createdEntryIds))
                )
              )
          : await tx
              .select({ athleteId: categoryEntries.athleteId })
              .from(categoryEntries)
              .where(inArray(categoryEntries.athleteId, createdAthleteIds));
      const strayByAthlete = new Map<string, number>();
      for (const e of strayEntries) {
        strayByAthlete.set(e.athleteId, (strayByAthlete.get(e.athleteId) ?? 0) + 1);
      }
      for (const [athleteId, count] of strayByAthlete) {
        blockers.push(
          `athlete "${names.get(athleteId) ?? athleteId}" has ${count} categor(ies) entry(ies) not created by this import`
        );
      }
    }

    if (createdCategoryIds.length > 0) {
      const catRows = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(inArray(categories.id, createdCategoryIds));
      const catNames = new Map(catRows.map((r) => [r.id, r.name]));

      // draws.categoryId and matches.categoryId are ON DELETE CASCADE:
      // deleting the category would silently nuke the draw and its matches.
      const drawn = await tx
        .select({ categoryId: draws.categoryId })
        .from(draws)
        .where(inArray(draws.categoryId, createdCategoryIds));
      for (const d of new Set(drawn.map((r) => r.categoryId))) {
        blockers.push(
          `category "${catNames.get(d) ?? d}" has a draw (it would be cascade-deleted)`
        );
      }
      const matched = await tx
        .select({ categoryId: matches.categoryId })
        .from(matches)
        .where(inArray(matches.categoryId, createdCategoryIds));
      const matchCountByCat = new Map<string, number>();
      for (const m of matched) {
        matchCountByCat.set(m.categoryId, (matchCountByCat.get(m.categoryId) ?? 0) + 1);
      }
      for (const [catId, count] of matchCountByCat) {
        blockers.push(
          `category "${catNames.get(catId) ?? catId}" has ${count} match(es) (they would be cascade-deleted)`
        );
      }

      // M5: categoryEntries.categoryId is ON DELETE CASCADE — deleting a
      // created category would silently wipe entries OTHER batches created
      // (e.g. an athlete import that entered athletes into this category
      // afterwards). Mirror the athlete branch's stray-entries check.
      const strayCatEntries =
        createdEntryIds.length > 0
          ? await tx
              .select({ categoryId: categoryEntries.categoryId })
              .from(categoryEntries)
              .where(
                and(
                  inArray(categoryEntries.categoryId, createdCategoryIds),
                  not(inArray(categoryEntries.id, createdEntryIds))
                )
              )
          : await tx
              .select({ categoryId: categoryEntries.categoryId })
              .from(categoryEntries)
              .where(inArray(categoryEntries.categoryId, createdCategoryIds));
      const strayByCat = new Map<string, number>();
      for (const e of strayCatEntries) {
        strayByCat.set(e.categoryId, (strayByCat.get(e.categoryId) ?? 0) + 1);
      }
      for (const [catId, count] of strayByCat) {
        blockers.push(
          `category "${catNames.get(catId) ?? catId}" has ${count} categor(ies) entry(ies) not created by this import`
        );
      }
    }

    if (blockers.length > 0) {
      throw new Error(
        `Cannot roll back this import: created rows are referenced elsewhere, ` +
          `and deleting them would corrupt draws or results:\n- ${blockers.join("\n- ")}\n` +
          `Detach or delete those references first, then roll back again.`
      );
    }

    // Categories whose entries are about to be deleted (captured before the
    // delete so athletesCount can be refreshed afterwards).
    let touchedCategoryIds: string[] = [];
    if (createdEntryIds.length > 0) {
      const rows = await tx
        .select({ categoryId: categoryEntries.categoryId })
        .from(categoryEntries)
        .where(inArray(categoryEntries.id, createdEntryIds));
      touchedCategoryIds = [...new Set(rows.map((r) => r.categoryId))];
    }

    // ---- (b) Deletes + restores + stamp, atomically ------------------------
    let deleted = 0;
    let restored = 0;

    // 1. Delete created rows, children before parents.
    for (const entity of ["category_entry", "athlete", "category"] as const) {
      const created = items.filter((i) => i.entity === entity && i.before === null);
      if (created.length === 0) continue;
      const table = ENTITY_TABLE[entity];
      await tx.delete(table).where(
        inArray(table.id, created.map((i) => i.entityId))
      );
      deleted += created.length;
    }

    // 2. Restore updated rows to their before-image.
    for (const item of items.filter((i) => i.before !== null)) {
      const table = ENTITY_TABLE[item.entity as keyof typeof ENTITY_TABLE];
      if (!table) continue;
      const before = { ...(item.before as Record<string, unknown>) };
      delete before.id;
      delete before.createdAt;
      await tx.update(table).set(before).where(eq(table.id, item.entityId));
      restored++;
    }

    await tx
      .update(importBatches)
      .set({ rolledBackAt: new Date() })
      .where(eq(importBatches.id, batchId));

    // ---- (c) Refresh cached entrant counts ---------------------------------
    for (const catId of touchedCategoryIds) {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(categoryEntries)
        .where(eq(categoryEntries.categoryId, catId));
      await tx
        .update(categories)
        .set({ athletesCount: count ?? 0 })
        .where(eq(categories.id, catId));
    }

    return { batchId, deleted, restored };
  });
}
