import { describe, expect, it } from "vitest";
import { buildTable, parseCsvText } from "./csv";

describe("parseCsvText", () => {
  it("strips a UTF-8 BOM", () => {
    const t = parseCsvText("﻿name,sex\nAarav,M");
    expect(t.headers).toEqual(["name", "sex"]);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].values).toEqual(["Aarav", "M"]);
  });

  it("handles quoted fields with embedded commas", () => {
    const t = parseCsvText('name,school\n"Aarav, Jr.",Delhi Public School');
    expect(t.rows[0].values).toEqual(["Aarav, Jr.", "Delhi Public School"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const t = parseCsvText('name\n"Say ""Hi"""\n');
    expect(t.rows[0].values).toEqual(['Say "Hi"']);
  });

  it("handles quoted fields spanning multiple lines", () => {
    const t = parseCsvText('name,note\nAarav,"line one\nline two"\nMeera,ok');
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].values).toEqual(["Aarav", "line one\nline two"]);
    expect(t.rows[1].values).toEqual(["Meera", "ok"]);
  });

  it("skips blank rows and # comment lines, keeping true line numbers", () => {
    const t = parseCsvText(
      "name,sex\n# a comment\nAarav,M\n\n   \nMeera,F\n"
    );
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].rowNumber).toBe(3);
    expect(t.rows[0].values).toEqual(["Aarav", "M"]);
    expect(t.rows[1].rowNumber).toBe(6);
  });

  it("trims whitespace around cells and headers", () => {
    const t = parseCsvText("  name , sex \n  Aarav  ,  M  ");
    expect(t.headers).toEqual(["name", "sex"]);
    expect(t.rows[0].values).toEqual(["Aarav", "M"]);
  });

  it("pads short rows and ignores extra cells", () => {
    const t = parseCsvText("a,b,c\n1,2\n3,4,5,6");
    expect(t.rows[0].values).toEqual(["1", "2", ""]);
    expect(t.rows[1].values).toEqual(["3", "4", "5"]);
  });

  it("handles CRLF line endings", () => {
    const t = parseCsvText("a,b\r\n1,2\r\n3,4\r\n");
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1].values).toEqual(["3", "4"]);
  });

  it("returns empty table for header-only or empty input", () => {
    expect(parseCsvText("")).toEqual({ headers: [], rows: [] });
    expect(parseCsvText("a,b\n")).toEqual({ headers: ["a", "b"], rows: [] });
  });
});

describe("buildTable", () => {
  it("aligns data rows to headers starting at line 2", () => {
    const t = buildTable(["a", "b"], [["1"], ["2", "3", "4"]]);
    expect(t.rows[0]).toEqual({ rowNumber: 2, values: ["1", ""] });
    expect(t.rows[1]).toEqual({ rowNumber: 3, values: ["2", "3"] });
  });
});
