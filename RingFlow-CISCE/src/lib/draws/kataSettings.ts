/**
 * Shared kata draw settings.
 *
 * One consistent vocabulary for the per-category kata draw configuration
 * across the admin UI, the `setKataDrawFormat` server action, the CSV import
 * and the draw engine. Everything reads and writes the same four columns on
 * `categories`:
 *
 * - `kata_format`          -> KataDrawFormat   (null = SINGLE_ELIM_REPECHAGE)
 * - `kata_ranking_method`  -> KataRankingMethod (null = WKF_VICTORY_POINTS)
 * - `kata_advance_per_group` -> number          (null = 2)
 * - `kata_group_size`      -> number | null     (null = WKF 3.7.9 table)
 *
 * The strict parsers in `kataDraws.ts` stay the engine's trust boundary for
 * values already in the database. This module adds the lenient variants the
 * CSV import needs (warnings, never errors) and the option labels the UI
 * shares with the import template docs.
 */
import {
  KATA_DRAW_FORMATS,
  KATA_RANKING_METHODS,
  parseKataDrawFormat,
  type KataDrawFormat,
  type KataRankingMethod,
} from "./kataDraws";

/** Labels shared by the admin UI (and mirrored in the import template). */
export const KATA_DRAW_FORMAT_OPTIONS: ReadonlyArray<{
  value: KataDrawFormat;
  label: string;
  hint: string;
}> = [
  {
    value: "SINGLE_ELIM_REPECHAGE",
    label: "Elimination",
    hint: "Single-elimination bracket with repechage",
  },
  {
    value: "GROUPS_THEN_ELIMINATION",
    label: "Groups + elimination",
    hint: "Round-robin groups first, top athletes advance to a knockout",
  },
  {
    value: "ROUND_ROBIN",
    label: "Round robin",
    hint: "Everyone faces everyone, no knockout",
  },
];

/** Labels shared by the admin UI (and mirrored in the import template). */
export const KATA_RANKING_METHOD_OPTIONS: ReadonlyArray<{
  value: KataRankingMethod;
  label: string;
  hint: string;
}> = [
  {
    value: "WKF_VICTORY_POINTS",
    label: "Victory points",
    hint: "3 points for a win, 1 for a draw (WKF)",
  },
  {
    value: "TOTAL_SCORE",
    label: "Total score",
    hint: "Rank by the sum of the judges' scores",
  },
];

export function kataDrawFormatLabel(value: unknown): string {
  const found = KATA_DRAW_FORMAT_OPTIONS.find((o) => o.value === value);
  return found ? found.label : "Elimination";
}

/** Compact label for the category-row badge; null when the default applies. */
export function kataDrawFormatShortLabel(value: unknown): string | null {
  if (value === "GROUPS_THEN_ELIMINATION") return "Groups";
  if (value === "ROUND_ROBIN") return "Round robin";
  return null;
}

/**
 * Lenient `kata_format` parsing for CSV imports, shaped like the import's
 * `parseEventType`: organisers write "groups", "round robin", "elimination".
 * Unknown values are reported (so the import can warn) rather than coerced.
 */
export function parseKataDrawFormatLoose(
  raw: string
): { value: KataDrawFormat | null; unknown: boolean } {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (!s) return { value: null, unknown: false };
  if (
    [
      "single_elim",
      "single_elimination",
      "elimination",
      "knockout",
      "single_elim_repechage",
    ].includes(s)
  ) {
    return { value: "SINGLE_ELIM_REPECHAGE", unknown: false };
  }
  if (
    [
      "groups",
      "group",
      "pools",
      "pool",
      "groups_elimination",
      "groups_then_elimination",
      "pools_then_elim",
    ].includes(s)
  ) {
    return { value: "GROUPS_THEN_ELIMINATION", unknown: false };
  }
  if (["round_robin", "roundrobin", "robin", "league"].includes(s)) {
    return { value: "ROUND_ROBIN", unknown: false };
  }
  return { value: null, unknown: true };
}

/**
 * Lenient `kata_ranking_method` parsing for CSV imports. Same
 * `{ value, unknown }` contract as `parseKataDrawFormatLoose`.
 */
export function parseKataRankingMethodLoose(
  raw: string
): { value: KataRankingMethod | null; unknown: boolean } {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (!s) return { value: null, unknown: false };
  if (["victory_points", "wkf_victory_points", "points", "victory"].includes(s)) {
    return { value: "WKF_VICTORY_POINTS", unknown: false };
  }
  if (["total_score", "totalscore", "score", "total"].includes(s)) {
    return { value: "TOTAL_SCORE", unknown: false };
  }
  return { value: null, unknown: true };
}

/**
 * Advance-per-group from UI/import input. Blank -> null (engine default);
 * out-of-range values are clamped to the sane 1..8 range.
 */
export function parseKataAdvancePerGroup(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(8, Math.max(1, n));
}

/**
 * Group-size override from UI/import input. Blank -> null (WKF 3.7.9 table);
 * out-of-range values are clamped to 2..128.
 */
export function parseKataGroupSize(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(128, Math.max(2, n));
}

/**
 * The single decision point the draw engine uses: which format a category's
 * draw is built with. Non-kata categories always use single elimination;
 * kata categories use their stored `kata_format` (blank -> the elimination
 * default). `performCategoryDraw` and the regression tests share this, so a
 * stored format can never be silently ignored again.
 */
export function resolveKataDrawFormat(
  isKata: boolean,
  storedFormat: unknown
): KataDrawFormat {
  if (!isKata) return "SINGLE_ELIM_REPECHAGE";
  return parseKataDrawFormat(storedFormat);
}

/** Strict membership checks for the server action's trust boundary. */
export function isKataDrawFormatValue(v: string): v is KataDrawFormat {
  return (KATA_DRAW_FORMATS as readonly string[]).includes(v);
}

export function isKataRankingMethodValue(v: string): v is KataRankingMethod {
  return (KATA_RANKING_METHODS as readonly string[]).includes(v);
}

/**
 * Pure kata-detection shared by the draw engine (`isKataCategory`) and the
 * admin categories page, so the UI shows the kata draw settings for exactly
 * the categories the engine treats as kata. Prefers the explicit `event_type`
 * on the tournament's category definitions — matched by normalised category
 * name, the same key the definition-sync uses — and falls back to the
 * historical name-contains-"kata" check for ad-hoc categories.
 */
export function isKataCategoryName(
  name: string,
  defs: Array<{ categoryName: string; eventType: string }>
): boolean {
  const norm = name.toLowerCase().trim();
  const def = defs.find((d) => d.categoryName.toLowerCase().trim() === norm);
  if (def) return def.eventType === "kata" || def.eventType === "team_kata";
  return norm.includes("kata");
}
