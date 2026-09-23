/**
 * Minimal RFC-4180-ish CSV parser. Handles:
 * - UTF-8 BOM
 * - quoted fields, including embedded commas, newlines and "" escapes
 * - CRLF / LF line endings
 * - `#` comment lines (skipped)
 * - blank rows (skipped)
 * - surrounding whitespace trimmed from every cell
 *
 * Deliberately dependency-free (no papaparse in package.json).
 */

export type ParsedRow = {
  /** 1-based line number in the original file (header is row 1). */
  rowNumber: number;
  /** Cell values aligned to the header columns (padded with ""). */
  values: string[];
};

export type ParsedTable = {
  /** Raw header cells, in order. */
  headers: string[];
  rows: ParsedRow[];
};

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Split raw text into logical CSV records, honouring quoted newlines. */
function splitRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      // Keep "" escapes verbatim for splitFields to decode; only the
      // quote state matters when finding record boundaries.
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      i += 1;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      records.push(current);
      current = "";
      // swallow the \n of a \r\n pair
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  // Trailing content without a line break is still a record; a trailing
  // line break is not.
  if (current !== "" || text.endsWith("\n") || text.endsWith("\r")) {
    records.push(current);
  }
  return records;
}

/** Split one logical record into fields. */
function splitFields(record: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < record.length) {
    const ch = record[i];
    if (ch === '"') {
      if (inQuotes && record[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Shared table builder: first raw row is the header, the rest are data.
 * Used by both the CSV parser and the Excel reader.
 */
export function buildTable(headerCells: string[], dataRows: string[][]): ParsedTable {
  const headers = headerCells.map((h) => h.trim());
  const rows: ParsedRow[] = [];
  // +2 because the header occupies line 1 and data starts at line 2.
  dataRows.forEach((cells, idx) => {
    const rowNumber = idx + 2;
    const values = headers.map((_, col) => (cells[col] ?? "").trim());
    rows.push({ rowNumber, values });
  });
  return { headers, rows };
}

export function parseCsvText(raw: string): ParsedTable {
  const text = stripBom(raw);
  const records = splitRecords(text);

  const dataRecords: { line: number; record: string }[] = [];
  let headerCells: string[] | null = null;

  records.forEach((record, idx) => {
    const lineNumber = idx + 1;
    const trimmed = record.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return; // blank / comment
    if (headerCells === null) {
      headerCells = splitFields(record);
      return;
    }
    dataRecords.push({ line: lineNumber, record });
  });

  if (!headerCells) return { headers: [], rows: [] };

  const rows: ParsedRow[] = dataRecords
    .map(({ line, record }) => {
      const cells = splitFields(record);
      // Skip rows that are entirely empty after trimming.
      if (cells.every((c) => c === "")) return null;
      const values = headerCells!.map((_, col) => (cells[col] ?? "").trim());
      return { rowNumber: line, values };
    })
    .filter((r): r is ParsedRow => r !== null);

  return { headers: headerCells, rows };
}
