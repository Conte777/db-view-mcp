import { describe, expect, it } from "vitest";
import { DbResolutionError, resolveDbId } from "../../src/utils/resolve-db.js";

const IDS = ["api_go", "billing-db", "analytics"];

describe("resolveDbId", () => {
  it("returns exact match as-is", () => {
    expect(resolveDbId(IDS, "api_go")).toBe("api_go");
  });

  it("resolves case-insensitively", () => {
    expect(resolveDbId(IDS, "API_GO")).toBe("api_go");
  });

  it("resolves ignoring dashes/underscores", () => {
    expect(resolveDbId(IDS, "apigo")).toBe("api_go");
    expect(resolveDbId(IDS, "billing_db")).toBe("billing-db");
  });

  it("resolves unique substring", () => {
    expect(resolveDbId(IDS, "api")).toBe("api_go");
    expect(resolveDbId(IDS, "billing")).toBe("billing-db");
  });

  it("resolves when input is a superset of an id", () => {
    expect(resolveDbId(IDS, "analytics_db")).toBe("analytics");
  });

  it("resolves when input is a superset spanning multiple tokens", () => {
    expect(resolveDbId(["main_pg"], "main_pg_db")).toBe("main_pg");
  });

  it("throws with valid IDs on no match", () => {
    expect(() => resolveDbId(IDS, "nope")).toThrow(/Valid IDs: api_go, billing-db, analytics/);
  });

  it("throws on ambiguous match listing candidates", () => {
    expect(() => resolveDbId(["users_pg", "users_ch"], "users")).toThrow(/Ambiguous.*users_pg, users_ch/);
  });

  it("throws on empty input instead of matching everything", () => {
    expect(() => resolveDbId(IDS, "")).toThrow(/Unknown database/);
  });

  it("does not match a short id that is merely a substring of the input", () => {
    expect(() => resolveDbId(["ch", "pg"], "search")).toThrow(/Unknown database/);
    expect(() => resolveDbId(["ch"], "march")).toThrow(/Unknown database/);
    expect(() => resolveDbId(["pg"], "gpg")).toThrow(/Unknown database/);
  });

  it("does not match a short input that is merely a substring of a longer id", () => {
    for (const id of ["search", "march", "archive", "research", "patch", "clickhouse_search"]) {
      expect(() => resolveDbId([id], "ch")).toThrow(/Unknown database/);
    }
    expect(() => resolveDbId(["gpg"], "pg")).toThrow(/Unknown database/);
  });

  it("does not match a 3+ char input at a non-token boundary of an id", () => {
    expect(() => resolveDbId(["search"], "arc")).toThrow(/Unknown database/);
    expect(() => resolveDbId(["clickhouse"], "click")).toThrow(/Unknown database/);
  });

  it("still resolves a token-aligned abbreviation", () => {
    expect(resolveDbId(["api_go_service"], "api_go")).toBe("api_go_service");
    expect(resolveDbId(["click_house"], "clickhouse")).toBe("click_house");
  });

  it("throws DbResolutionError with code DB_NOT_FOUND on unknown database", () => {
    expect.assertions(2);
    try {
      resolveDbId(IDS, "nope");
    } catch (err) {
      expect(err).toBeInstanceOf(DbResolutionError);
      expect((err as DbResolutionError).code).toBe("DB_NOT_FOUND");
    }
  });

  it("throws DbResolutionError with code DB_AMBIGUOUS on ambiguous match", () => {
    expect.assertions(2);
    try {
      resolveDbId(["users_pg", "users_ch"], "users");
    } catch (err) {
      expect(err).toBeInstanceOf(DbResolutionError);
      expect((err as DbResolutionError).code).toBe("DB_AMBIGUOUS");
    }
  });
});
