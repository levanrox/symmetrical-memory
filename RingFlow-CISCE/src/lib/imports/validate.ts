/**
 * Pure validation helpers for the P6 import flow: downloadable templates,
 * header canonicalisation, field parsing, event-type inference and
 * athlete-vs-category mismatch warnings (warnings, never errors).
 */
import type { ParsedTable } from "./csv";

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const CATEGORY_TEMPLATE_HEADERS = [
  "name",
  "code",
  "event_type",
  "sex",
  "age_min",
  "age_max",
  "age_bracket",
  "weight_class",
  "belt",
  "day",
  "bronze_medals",
] as const;

export const ATHLETE_TEMPLATE_HEADERS = [
  "name",
  "sports_id",
  "chest_number",
  "school",
  "school_code",
  "sex",
  "age",
  "weight",
  "belt",
  "category",
  "code",
] as const;

const CATEGORY_EXAMPLE =
  "Boys Kumite U12 40kg,BU12K40,kumite,M,10,12,U12,35-40 kg,,Day 1,2";

const ATHLETE_EXAMPLE =
  "Aarav Sharma,SP-1001,,Delhi Public School,DPS,M,11,38,Blue,Boys Kumite U12 40kg,BU12K40";

export function categoryTemplateCsv(): string {
  return (
    `# RingFlow category import template — one row per category.\n` +
    `# Lines starting with # are ignored. event_type: kata | kumite | team_kata | team_kumite\n` +
    `# (left blank it is inferred: names containing "kata" become kata, otherwise kumite).\n` +
    `# sex: M | F | any. code is an optional short alias athletes can reference instead of the full name.\n` +
    `${CATEGORY_TEMPLATE_HEADERS.join(",")}\n` +
    `${CATEGORY_EXAMPLE}\n`
  );
}

export function athleteTemplateCsv(
  categories: Array<{ name: string; code: string | null }>
): string {
  const ref = categories
    .map((c) => `#   - ${c.name}${c.code ? `  (code: ${c.code})` : ""}`)
    .join("\n");
  return (
    `# RingFlow athlete import template — one row per athlete per category.\n` +
    `# Lines starting with # are ignored. The same athlete in kata AND kumite is normal:\n` +
    `# repeat the row with a different category (use sports_id so both rows link to one athlete).\n` +
    `# category must match an existing category name (or code). sex: M | F. age: years. weight: kg.\n` +
    (ref ? `# Existing categories in this tournament:\n${ref}\n` : "") +
    `${ATHLETE_TEMPLATE_HEADERS.join(",")}\n` +
    `${ATHLETE_EXAMPLE}\n`
  );
}

/* ------------------------------------------------------------------ */
/* Header canonicalisation                                             */
/* ------------------------------------------------------------------ */

/** Maps the many header spellings organisers use onto canonical fields. */
const HEADER_ALIASES: Record<string, string> = {
  // categories
  category: "name",
  "category name": "name",
  categoryname: "name",
  title: "name",
  code: "code",
  categorycode: "code",
  "category code": "code",
  shortcode: "code",
  "short code": "code",
  eventtype: "event_type",
  "event type": "event_type",
  event: "event_type",
  discipline: "event_type",
  gender: "sex",
  agebracket: "age_bracket",
  "age bracket": "age_bracket",
  bracket: "age_bracket",
  agemin: "age_min",
  "age min": "age_min",
  minage: "age_min",
  "min age": "age_min",
  agemax: "age_max",
  "age max": "age_max",
  maxage: "age_max",
  "max age": "age_max",
  weightclass: "weight_class",
  "weight class": "weight_class",
  weight: "weight_class",
  bronzemedals: "bronze_medals",
  "bronze medals": "bronze_medals",
  // athletes
  athlete: "name",
  "athlete name": "name",
  competitor: "name",
  sportsid: "sports_id",
  "sports id": "sports_id",
  chestnumber: "chest_number",
  "chest number": "chest_number",
  chestno: "chest_number",
  "chest no": "chest_number",
  dojo: "school",
  club: "school",
  team: "school",
  schoolcode: "school_code",
  "school code": "school_code",
};

export function canonicalHeader(raw: string): string {
  const key = raw.toLowerCase().trim().replace(/[\s_-]+/g, "");
  // Try the spaceless key first, then the plain lowercased form.
  return (
    HEADER_ALIASES[key] ??
    HEADER_ALIASES[raw.toLowerCase().trim()] ??
    raw.toLowerCase().trim().replace(/\s+/g, "_")
  );
}

/** Convert a parsed table into rows keyed by canonical header name. */
export function tableToFieldRows(table: ParsedTable): {
  rowNumber: number;
  fields: Record<string, string>;
}[] {
  const canonical = table.headers.map(canonicalHeader);
  return table.rows.map((r) => {
    const fields: Record<string, string> = {};
    canonical.forEach((h, i) => {
      if (!(h in fields)) fields[h] = r.values[i] ?? "";
    });
    return { rowNumber: r.rowNumber, fields };
  });
}

/* ------------------------------------------------------------------ */
/* Field parsing                                                       */
/* ------------------------------------------------------------------ */

export function parseOptionalInt(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number.parseInt(s.replace(/[^0-9-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

export function parseOptionalNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number.parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? null : n;
}

/** Normalise sex to M/F/null. Returns the value plus whether it was unknown. */
export function normalizeSexField(raw: string): { value: "M" | "F" | null; unknown: boolean } {
  const s = raw.trim().toLowerCase();
  if (!s || s === "any" || s === "mixed" || s === "open" || s === "-") {
    return { value: null, unknown: false };
  }
  if (["m", "male", "boy", "boys", "men"].includes(s)) return { value: "M", unknown: false };
  if (["f", "female", "girl", "girls", "women"].includes(s)) return { value: "F", unknown: false };
  return { value: null, unknown: true };
}

export type EventType = "kata" | "kumite" | "team_kata" | "team_kumite";

/** Kata when the name contains "kata", otherwise kumite. */
export function inferEventType(name: string): "kata" | "kumite" {
  return /kata/i.test(name) ? "kata" : "kumite";
}

export function parseEventType(raw: string): { value: EventType | null; unknown: boolean } {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (!s) return { value: null, unknown: false };
  if (["kata", "team_kata"].includes(s)) return { value: s as EventType, unknown: false };
  if (["kumite", "team_kumite"].includes(s)) return { value: s as EventType, unknown: false };
  return { value: null, unknown: true };
}

/** Parse "35-40 kg", "-40kg", "+80 kg", "60kg" into a numeric range. */
export function parseWeightRange(
  weightClass: string | null | undefined
): { min: number | null; max: number | null } | null {
  if (!weightClass) return null;
  const s = weightClass.trim().toLowerCase().replace(/kg/g, "").trim();
  if (!s) return null;
  if (s.startsWith("+")) {
    const n = Number.parseFloat(s.slice(1));
    return Number.isNaN(n) ? null : { min: n, max: null };
  }
  if (s.startsWith("-") || s.startsWith("–")) {
    const n = Number.parseFloat(s.slice(1));
    return Number.isNaN(n) ? null : { min: null, max: n };
  }
  const parts = s.split(/[-–]/).map((p) => Number.parseFloat(p.trim()));
  if (parts.length === 2 && !parts.some((p) => Number.isNaN(p))) {
    return { min: parts[0], max: parts[1] };
  }
  const single = Number.parseFloat(s);
  if (!Number.isNaN(single)) return { min: single, max: single };
  return null;
}

/* ------------------------------------------------------------------ */
/* Row-level field validation (pure; no DB)                            */
/* ------------------------------------------------------------------ */

export type FieldCheck = {
  fields: Record<string, string>;
  errors: string[];
  warnings: string[];
};

export function checkCategoryFields(raw: Record<string, string>): FieldCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fields: Record<string, string> = {};

  const name = (raw.name ?? "").trim();
  if (!name) errors.push("name is required");
  fields.name = name;

  fields.code = (raw.code ?? "").trim();

  const et = parseEventType(raw.event_type ?? "");
  if (et.unknown) warnings.push(`event_type "${raw.event_type}" not recognised — inferred instead`);
  fields.event_type = et.value ?? "";

  const sex = normalizeSexField(raw.sex ?? "");
  if (sex.unknown) warnings.push(`sex "${raw.sex}" not recognised — treated as any`);
  fields.sex = sex.value ?? "";

  const ageMin = parseOptionalInt(raw.age_min ?? "");
  const ageMax = parseOptionalInt(raw.age_max ?? "");
  if ((raw.age_min ?? "").trim() && ageMin === null) errors.push(`age_min "${raw.age_min}" is not a number`);
  if ((raw.age_max ?? "").trim() && ageMax === null) errors.push(`age_max "${raw.age_max}" is not a number`);
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    errors.push(`age_min (${ageMin}) is greater than age_max (${ageMax})`);
  }
  fields.age_min = ageMin !== null ? String(ageMin) : "";
  fields.age_max = ageMax !== null ? String(ageMax) : "";

  fields.age_bracket = (raw.age_bracket ?? "").trim();
  fields.weight_class = (raw.weight_class ?? "").trim();
  fields.belt = (raw.belt ?? "").trim();
  fields.day = (raw.day ?? "").trim();

  const bronze = parseOptionalInt(raw.bronze_medals ?? "");
  if ((raw.bronze_medals ?? "").trim() && bronze === null) {
    warnings.push(`bronze_medals "${raw.bronze_medals}" is not a number — ignored`);
  }
  fields.bronze_medals = bronze !== null ? String(bronze) : "";

  return { fields, errors, warnings };
}

export function checkAthleteFields(raw: Record<string, string>): FieldCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fields: Record<string, string> = {};

  const name = (raw.name ?? "").trim();
  if (!name) errors.push("name is required");
  fields.name = name;

  fields.sports_id = (raw.sports_id ?? "").trim();
  fields.chest_number = (raw.chest_number ?? "").trim();
  fields.school = (raw.school ?? "").trim();
  fields.school_code = (raw.school_code ?? "").trim();
  fields.belt = (raw.belt ?? "").trim();

  const sex = normalizeSexField(raw.sex ?? "");
  if (sex.unknown) warnings.push(`sex "${raw.sex}" not recognised — treated as unknown`);
  fields.sex = sex.value ?? "";

  const age = parseOptionalNumber(raw.age ?? "");
  if ((raw.age ?? "").trim() && age === null) errors.push(`age "${raw.age}" is not a number`);
  fields.age = age !== null ? String(age) : "";

  const weight = parseOptionalNumber(raw.weight ?? "");
  if ((raw.weight ?? "").trim() && weight === null) errors.push(`weight "${raw.weight}" is not a number`);
  fields.weight = weight !== null ? String(weight) : "";

  fields.category = (raw.category ?? "").trim();
  fields.code = (raw.code ?? "").trim();
  if (!fields.category && !fields.code) {
    errors.push("category (or code) is required to place the athlete");
  }

  return { fields, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* Mismatch warnings: athlete vs category (warnings, never errors)     */
/* ------------------------------------------------------------------ */

export type CategoryShape = {
  sex: string | null;
  ageMin: number | null;
  ageMax: number | null;
  weightClass: string | null;
  name: string;
};

export function athleteCategoryWarnings(
  athlete: { sex: string | null; age: number | null; weight: number | null; name: string },
  category: CategoryShape
): string[] {
  const warnings: string[] = [];

  if (category.sex && athlete.sex && category.sex !== athlete.sex) {
    warnings.push(
      `sex mismatch: athlete is ${athlete.sex === "M" ? "male" : "female"} but category "${category.name}" is ${category.sex === "M" ? "male" : "female"}`
    );
  }
  if (athlete.age !== null) {
    if (category.ageMin !== null && athlete.age < category.ageMin) {
      warnings.push(`age ${athlete.age} is below the category minimum (${category.ageMin})`);
    }
    if (category.ageMax !== null && athlete.age > category.ageMax) {
      warnings.push(`age ${athlete.age} is above the category maximum (${category.ageMax})`);
    }
  }
  if (athlete.weight !== null) {
    const range = parseWeightRange(category.weightClass);
    if (range) {
      if (range.min !== null && athlete.weight < range.min) {
        warnings.push(`weight ${athlete.weight}kg is below the category range (${category.weightClass})`);
      }
      if (range.max !== null && athlete.weight > range.max) {
        warnings.push(`weight ${athlete.weight}kg is above the category range (${category.weightClass})`);
      }
    }
  }
  return warnings;
}

/* ------------------------------------------------------------------ */
/* Pure upsert planning helpers (DB-free, unit-testable)                */
/* ------------------------------------------------------------------ */

/**
 * Diff an incoming field map against an existing row. Only columns present
 * in the file (presentColumns) are considered — absent columns are left
 * alone so a partial re-import never wipes data. Returns null when nothing
 * would change. `mapField` converts canonical import fields to DB columns.
 */
export function diffRow(
  existing: Record<string, unknown>,
  incoming: Record<string, string>,
  presentColumns: Set<string>,
  mapField: (field: string, value: string) => [column: string, dbValue: unknown] | null
): Record<string, unknown> | null {
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(incoming)) {
    if (!presentColumns.has(field)) continue;
    const mapped = mapField(field, value);
    if (!mapped) continue;
    const [column, dbValue] = mapped;
    const current = existing[column];
    const normCurrent = current === null || current === undefined ? null : String(current);
    const normNext = dbValue === null || dbValue === undefined ? null : String(dbValue);
    if (normCurrent !== normNext) changes[column] = dbValue;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Numeric chest numbers only; "A12" style values are ignored for sequencing. */
export function maxNumericChestNumber(chestNumbers: Array<string | null>): number {
  let max = 0;
  for (const c of chestNumbers) {
    if (!c) continue;
    const n = /^\d+$/.test(c.trim()) ? Number.parseInt(c.trim(), 10) : NaN;
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

/** Assign sequential chest numbers starting after the current max. */
export function assignChestNumbers(
  existing: Array<string | null>,
  needed: number
): string[] {
  let next = maxNumericChestNumber(existing) + 1;
  const out: string[] = [];
  for (let i = 0; i < needed; i++) out.push(String(next++));
  return out;
}
