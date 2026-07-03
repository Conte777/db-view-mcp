import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatError, formatRows, formatSuccess, setRowFormat } from "../../src/utils/response.js";

beforeEach(() => {
  setRowFormat("json");
});

afterEach(() => {
  setRowFormat("json");
});

describe("formatSuccess", () => {
  it("wraps data in content array", () => {
    const result = formatSuccess({ data: "hello" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe("hello");
  });

  it("includes rows and count", () => {
    const result = formatSuccess({ rows: [{ id: 1 }], count: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows).toEqual([{ id: 1 }]);
    expect(parsed.count).toBe(1);
  });

  it("emits compact JSON without indentation", () => {
    const result = formatSuccess({ data: "hello" });
    expect(result.content[0].text).not.toContain("\n");
    expect(result.content[0].text).toBe(JSON.stringify({ success: true, data: "hello" }));
  });

  it("sanitizes Buffer cells in rows (write path with RETURNING)", () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const result = formatSuccess({ rows: [{ blob: buf }], count: 1, database: "db" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0].blob).toBe("<binary 4 bytes: deadbeef...>");
  });

  it("truncates an oversized string cell in rows", () => {
    const big = "y".repeat(20_000);
    const result = formatSuccess({ rows: [{ v: big }], count: 1, database: "db" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0].v).toBe(`${"y".repeat(10_000)}... [truncated, 20000 chars total]`);
  });

  it("caps total payload by dropping rows and flagging truncation", () => {
    const bigValue = "z".repeat(5_000);
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, value: bigValue }));
    const result = formatSuccess({ rows, count: 500, database: "db" });
    const parsed = JSON.parse(result.content[0].text);
    expect(result.content[0].text.length).toBeLessThanOrEqual(1_000_000);
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows.length).toBeLessThan(500);
  });

  it("preserves truncatedAt passed by the write path", () => {
    const result = formatSuccess({ rows: [{ a: 1 }], count: 3, database: "db", truncatedAt: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.truncatedAt).toBe(1);
    expect(parsed.rows).toEqual([{ a: 1 }]);
  });
});

describe("formatError", () => {
  it("returns isError true", () => {
    const result = formatError("something went wrong");
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("something went wrong");
  });

  it("includes error code", () => {
    const result = formatError("bad", "ERR_CODE");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("ERR_CODE");
  });

  it("emits compact JSON without indentation", () => {
    const result = formatError("bad", "ERR_CODE");
    expect(result.content[0].text).not.toContain("\n");
  });
});

describe("formatRows", () => {
  it("formats rows with database and count", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const result = formatRows(rows, "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.rows).toEqual(rows);
    expect(parsed.count).toBe(2);
    expect(parsed.database).toBe("test_db");
    expect(parsed.truncated).toBeUndefined();
  });

  it("emits compact JSON without indentation", () => {
    const result = formatRows([{ id: 1 }], "test_db");
    expect(result.content[0].text).not.toContain("\n");
  });

  it("replaces Buffer cells with a binary placeholder", () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const result = formatRows([{ data: buf }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0].data).toBe(`<binary 4 bytes: deadbeef...>`);
  });

  it("replaces Uint8Array cells with a binary placeholder", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = formatRows([{ data: bytes }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0].data).toBe(`<binary 3 bytes: 010203...>`);
  });

  it("previews only the first 16 bytes of large binary cells", () => {
    const buf = Buffer.alloc(64, 0xaa);
    const result = formatRows([{ data: buf }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0].data).toBe(`<binary 64 bytes: ${"aa".repeat(16)}...>`);
  });

  it("truncates long string cells with a marker", () => {
    const longString = "x".repeat(10_001);
    const result = formatRows([{ text: longString }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0].text).toBe(`${"x".repeat(10_000)}... [truncated, 10001 chars total]`);
  });

  it("leaves strings at or under the cell cap untouched", () => {
    const exact = "x".repeat(10_000);
    const result = formatRows([{ text: exact }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows[0].text).toBe(exact);
  });

  it("drops trailing rows and flags truncation when payload exceeds the cap", () => {
    const bigValue = "x".repeat(5_000);
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, value: bigValue }));
    const result = formatRows(rows, "test_db");
    const parsed = JSON.parse(result.content[0].text);

    expect(result.content[0].text.length).toBeLessThanOrEqual(1_000_000);
    expect(parsed.truncated).toBe(true);
    expect(parsed.count).toBe(500);
    expect(parsed.returnedRows).toBe(parsed.rows.length);
    expect(parsed.rows.length).toBeLessThan(500);
  });
});

describe("rowFormat: table", () => {
  it("leaves output byte-identical to current JSON when flag is off", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const result = formatRows(rows, "test_db");
    expect(result.content[0].text).toBe(JSON.stringify({ success: true, rows, count: 2, database: "test_db" }));
  });

  it("renders a header line plus one line per row", () => {
    setRowFormat("table");
    const result = formatRows(
      [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ],
      "test_db",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows).toBeUndefined();
    expect(parsed.rowsTable).toBe("id|name\n1|a\n2|b");
  });

  it("escapes backslash, pipe and newline in cells", () => {
    setRowFormat("table");
    const result = formatRows([{ v: "a\\b|c\nd" }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rowsTable).toBe("v\na\\\\b\\|c\\nd");
  });

  it("renders null and missing keys as bare NULL, literal 'NULL' string quoted, empty string as empty cell", () => {
    setRowFormat("table");
    const result = formatRows([{ a: null, b: "NULL", c: "" }, { a: 1 }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rowsTable).toBe('a|b|c\nNULL|"NULL"|\n1|NULL|NULL');
  });

  it("renders nested object/array cells as compact JSON", () => {
    setRowFormat("table");
    const result = formatRows([{ obj: { a: 1 }, arr: [1, 2] }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rowsTable).toBe('obj|arr\n{"a":1}|[1,2]');
  });

  it("escapes quotes in string cells so lookalikes stay distinguishable", () => {
    setRowFormat("table");
    const asString = formatRows([{ v: '"NULL"' }], "test_db");
    const asMarker = formatRows([{ v: "NULL" }], "test_db");
    expect(JSON.parse(asString.content[0].text).rowsTable).toBe('v\n\\"NULL\\"');
    expect(JSON.parse(asMarker.content[0].text).rowsTable).toBe('v\n"NULL"');

    const jsonLikeString = formatRows([{ v: '{"a":1}' }], "test_db");
    const realObject = formatRows([{ v: { a: 1 } }], "test_db");
    expect(JSON.parse(jsonLikeString.content[0].text).rowsTable).toBe('v\n{\\"a\\":1}');
    expect(JSON.parse(realObject.content[0].text).rowsTable).toBe('v\n{"a":1}');
  });

  it("renders non-finite numbers as NULL, matching JSON-mode coercion", () => {
    setRowFormat("table");
    const result = formatRows([{ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: 1.5 }], "test_db");
    expect(JSON.parse(result.content[0].text).rowsTable).toBe("a|b|c\nNULL|NULL|1.5");
  });

  it("unions heterogeneous row keys in first-appearance order", () => {
    setRowFormat("table");
    const result = formatRows([{ a: 1, b: 2 }, { c: 3 }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rowsTable).toBe("a|b|c\n1|2|NULL\nNULL|NULL|3");
  });

  it("renders a sanitized Buffer cell as its binary placeholder text", () => {
    setRowFormat("table");
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const result = formatRows([{ data: buf }], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rowsTable).toBe("data\n<binary 4 bytes: deadbeef...>");
  });

  it("drops trailing rows and flags truncation when the table payload exceeds the cap", () => {
    setRowFormat("table");
    const bigValue = "x".repeat(5_000);
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, value: bigValue }));
    const result = formatRows(rows, "test_db");
    const parsed = JSON.parse(result.content[0].text);

    expect(result.content[0].text.length).toBeLessThanOrEqual(1_000_000);
    expect(parsed.rows).toBeUndefined();
    expect(parsed.truncated).toBe(true);
    expect(parsed.count).toBe(500);
    const lineCount = parsed.rowsTable.split("\n").length - 1; // minus header
    expect(parsed.returnedRows).toBe(lineCount);
    expect(lineCount).toBeLessThan(500);
  });

  it("renders rowsTable on the formatSuccess write path, preserving truncatedAt", () => {
    setRowFormat("table");
    const result = formatSuccess({ rows: [{ a: 1 }], count: 3, database: "db", truncatedAt: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows).toBeUndefined();
    expect(parsed.rowsTable).toBe("a\n1");
    expect(parsed.truncatedAt).toBe(1);
  });

  it("keeps an empty rows array as JSON, not a table, since there is nothing to tabulate", () => {
    setRowFormat("table");
    const result = formatRows([], "test_db");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows).toEqual([]);
    expect(parsed.rowsTable).toBeUndefined();
  });
});
