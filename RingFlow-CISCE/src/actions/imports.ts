"use server";

import { ensureOrganiserHasAccessToTournament } from "./organiser";
import { parseCsvText, type ParsedTable } from "@/lib/imports/csv";
import { detectFileKind, parseWorkbook } from "@/lib/imports/excel";
import { canonicalHeader, tableToFieldRows } from "@/lib/imports/validate";
import {
  buildAthletePreview,
  buildCategoryPreview,
  commitAthleteImport,
  commitCategoryImport,
  listImportBatches,
  rollbackImportBatch,
} from "@/lib/imports/upsert";
import type {
  ImportKind,
  ImportPreview,
  ImportResolutions,
  ImportSummary,
} from "@/lib/imports/types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

function actorLabel(auth: { role: string; id?: string; name?: string | null }): string {
  if (auth.role === "admin") return `admin:${auth.id ?? "unknown"}`;
  return `organiser:${auth.name ?? auth.id ?? "unknown"}`;
}

async function parseUpload(file: File): Promise<{
  table: ParsedTable;
  presentColumns: string[];
  fieldRows: { rowNumber: number; fields: Record<string, string> }[];
}> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File is too large (max 5 MB)");
  }
  const kind = detectFileKind({ name: file.name, type: file.type });
  const buffer = await file.arrayBuffer();
  const table =
    kind === "excel" ? parseWorkbook(buffer) : parseCsvText(new TextDecoder("utf-8").decode(buffer));

  if (table.headers.length === 0 || table.rows.length === 0) {
    throw new Error("No data rows found in the file");
  }
  if (table.rows.length > MAX_ROWS) {
    throw new Error(`Too many rows (max ${MAX_ROWS})`);
  }
  const canonical = table.headers.map(canonicalHeader);
  const presentColumns = [...new Set(canonical)];
  const fieldRows = tableToFieldRows(table);
  return { table, presentColumns, fieldRows };
}

/**
 * Phase 1 of the import: parse the uploaded file and return a full preview
 * (per-row actions, warnings, errors, category matches) for the organiser to
 * review. Nothing is written.
 */
export async function previewImportAction(
  tournamentId: string,
  formData: FormData
): Promise<ImportPreview & { presentColumns: string[]; filename: string }> {
  await ensureOrganiserHasAccessToTournament(tournamentId);

  const kind = formData.get("kind");
  if (kind !== "categories" && kind !== "athletes") {
    throw new Error("kind must be 'categories' or 'athletes'");
  }
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const { presentColumns, fieldRows } = await parseUpload(file);
  const filename = file.name;

  const preview =
    kind === "categories"
      ? await buildCategoryPreview(tournamentId, fieldRows, new Set(presentColumns))
      : await buildAthletePreview(tournamentId, fieldRows, new Set(presentColumns));

  return { ...preview, filename, presentColumns };
}

export type ConfirmImportPayload = {
  kind: ImportKind;
  filename: string;
  rows: { rowNumber: number; fields: Record<string, string> }[];
  presentColumns: string[];
  resolutions?: ImportResolutions;
};

/**
 * Phase 2: commit a previewed import. The plan is rebuilt from the raw rows
 * plus the organiser's resolutions, so the commit can never act on stale
 * preview data. Writes one import_batches row + per-row before/after items.
 */
export async function confirmImportAction(
  tournamentId: string,
  payload: ConfirmImportPayload
): Promise<ImportSummary> {
  const auth = await ensureOrganiserHasAccessToTournament(tournamentId);
  const createdBy = actorLabel(auth as { role: string; id?: string; name?: string | null });

  if (!payload.rows || payload.rows.length === 0) {
    throw new Error("Nothing to import");
  }
  if (payload.rows.length > MAX_ROWS) {
    throw new Error(`Too many rows (max ${MAX_ROWS})`);
  }

  const input = {
    tournamentId,
    filename: payload.filename,
    createdBy,
    fieldRows: payload.rows,
    presentColumns: payload.presentColumns,
    resolutions: payload.resolutions,
  };

  if (payload.kind === "categories") return commitCategoryImport(input);
  return commitAthleteImport(input);
}

export async function rollbackImportAction(
  tournamentId: string,
  batchId: string
) {
  await ensureOrganiserHasAccessToTournament(tournamentId);
  return rollbackImportBatch(tournamentId, batchId);
}

export async function getImportBatchesAction(tournamentId: string) {
  await ensureOrganiserHasAccessToTournament(tournamentId);
  return listImportBatches(tournamentId);
}
