import { describe, it, expect } from "vitest";
import { formatSuccess, formatError, formatRows } from "../../src/utils/response.js";

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
  });
});
