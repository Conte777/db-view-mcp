import { describe, it, expect } from "vitest";
import { resolveDbId } from "../../src/utils/resolve-db.js";

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

  it("throws with valid IDs on no match", () => {
    expect(() => resolveDbId(IDS, "nope")).toThrow(/Valid IDs: api_go, billing-db, analytics/);
  });

  it("throws on ambiguous match listing candidates", () => {
    expect(() => resolveDbId(["users_pg", "users_ch"], "users")).toThrow(/Ambiguous.*users_pg, users_ch/);
  });

  it("throws on empty input instead of matching everything", () => {
    expect(() => resolveDbId(IDS, "")).toThrow(/Unknown database/);
  });
});
