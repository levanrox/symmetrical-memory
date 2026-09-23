/**
 * Shared, JSON-serializable types for the P6 CSV/Excel import flow
 * (categories + athletes). Server actions return these to the client,
 * so keep everything plain data — no Dates, no class instances.
 */

export type ImportKind = "categories" | "athletes";

export type RowIssue = {
  /** 1-based line number in the uploaded file (header is row 1). */
  row: number;
  /** Human-readable description. */
  message: string;
};

export type CategorySuggestion = {
  id: string;
  name: string;
  code: string | null;
  /** Levenshtein distance to the query; lower is closer. */
  distance: number;
};

export type CategoryPreviewRow = {
  row: number;
  /** Raw canonicalised fields from the file. */
  fields: Record<string, string>;
  /** create | update | skip | error | blocked (draw locked) */
  action: "create" | "update" | "skip" | "error" | "blocked";
  errors: string[];
  warnings: string[];
  /** Inferred or organiser-overridden event type. */
  eventType: "kata" | "kumite" | "team_kata" | "team_kumite";
  eventTypeInferred: boolean;
  /** Existing category id when matched, else null. */
  matchedCategoryId: string | null;
  matchedCategoryName: string | null;
  /** Set when the matched category's draw is locked. */
  drawLocked: boolean;
};

export type AthletePreviewRow = {
  row: number;
  fields: Record<string, string>;
  /** create | update | entry (athlete exists, new category entry) | skip | error | blocked | unmatched */
  action: "create" | "update" | "entry" | "skip" | "error" | "blocked" | "unmatched";
  errors: string[];
  warnings: string[];
  /** How the category was resolved. */
  categoryMatch: "code" | "exact" | "resolved" | "none";
  matchedCategoryId: string | null;
  matchedCategoryName: string | null;
  suggestions: CategorySuggestion[];
  /** Existing athlete id when matched, else null. */
  matchedAthleteId: string | null;
  /** Projected chest number (auto-assigned or from file). Null when unknown. */
  chestNumber: string | null;
  chestNumberAuto: boolean;
  drawLocked: boolean;
};

export type CategoryPreview = {
  kind: "categories";
  filename: string;
  rows: CategoryPreviewRow[];
  errors: RowIssue[];
  /** Locked category ids referenced by blocked rows. */
  lockedCategoryIds: string[];
  lockedCategoryNames: Record<string, string>;
};

export type AthletePreview = {
  kind: "athletes";
  filename: string;
  rows: AthletePreviewRow[];
  errors: RowIssue[];
  lockedCategoryIds: string[];
  lockedCategoryNames: Record<string, string>;
};

export type ImportPreview = CategoryPreview | AthletePreview;

/** Organiser decisions collected in the preview UI before commit. */
export type ImportResolutions = {
  /** rowNumber -> overridden event type (categories only). */
  eventTypeOverrides?: Record<number, "kata" | "kumite" | "team_kata" | "team_kumite">;
  /**
   * rowNumber -> chosen category id (athletes only). SKIP_SENTINEL means the
   * organiser explicitly chose "leave unmatched" — the row is skipped.
   * Absent means no decision yet.
   */
  categoryResolutions?: Record<number, string>;
  /** Category ids whose locked draws the organiser explicitly voids. */
  unlockCategoryIds?: string[];
};

/**
 * Sentinel stored in resolutions.categoryResolutions[row] when the organiser
 * picks "Leave unmatched (skip row)" in the preview UI. Lives here (not in
 * upsert.ts) so client components can import it without pulling in @/db.
 */
export const SKIP_SENTINEL = "__SKIP__";

export type ImportSummary = {
  batchId: string;
  kind: ImportKind;
  created: number;
  updated: number;
  skipped: number;
  errors: RowIssue[];
  /** Category ids whose draws were voided (unlocked) by this import. */
  voidedDraws: string[];
};

export type ImportBatchSummary = {
  id: string;
  kind: ImportKind;
  filename: string | null;
  rowCounts: { created: number; updated: number; skipped: number; errors: number };
  createdBy: string | null;
  createdAt: string;
  rolledBackAt: string | null;
};

export type RollbackSummary = {
  batchId: string;
  deleted: number;
  restored: number;
};
