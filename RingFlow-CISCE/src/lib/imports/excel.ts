/**
 * Excel (.xlsx / .xls) reading for imports. Only the first worksheet is
 * used; every cell is stringified and handed to the shared table builder
 * from csv.ts so CSV and Excel behave identically downstream.
 *
 * `xlsx` v0.18.5 is already a dependency — no new packages.
 */
import * as XLSX from "xlsx";
import { buildTable, type ParsedTable } from "./csv";

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number") {
    // Avoid "1e+21" style output for large integers.
    return Number.isInteger(cell) && Math.abs(cell) < 1e15
      ? String(cell)
      : String(cell);
  }
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === "boolean") return cell ? "true" : "false";
  return String(cell);
}

export function parseWorkbook(buffer: ArrayBuffer): ParsedTable {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  if (aoa.length === 0) return { headers: [], rows: [] };

  const [headerRow, ...dataRows] = aoa;
  const headers = headerRow.map(cellToString);
  // Mirror the CSV parser: skip blank rows and `#` comment rows.
  const data = dataRows
    .map((row) => row.map(cellToString))
    .filter((row) => {
      if (row.every((c) => c.trim() === "")) return false;
      const first = (row[0] ?? "").trim();
      return !first.startsWith("#");
    });
  return buildTable(headers, data);
}

/** Sniff the file kind from name / MIME so we pick the right parser. */
export function detectFileKind(file: { name: string; type: string }): "csv" | "excel" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "excel";
  if (
    file.type.includes("spreadsheet") ||
    file.type.includes("excel") ||
    file.type.includes("openxml")
  ) {
    return "excel";
  }
  return "csv";
}
