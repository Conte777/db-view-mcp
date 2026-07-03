import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogger, initLogger, Logger } from "../../src/utils/logger.js";

let writes: string[] = [];

beforeEach(() => {
  writes = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  initLogger("info"); // reset the module singleton
});

afterEach(() => {
  vi.restoreAllMocks();
});

function firstEntry() {
  return JSON.parse(writes[0]);
}

describe("Logger level filtering", () => {
  it("suppresses a level below the configured threshold", () => {
    new Logger("info").debug("hidden");
    expect(writes).toHaveLength(0);
  });

  it("emits a level at or above the threshold", () => {
    new Logger("info").warn("shown");
    expect(firstEntry().message).toBe("shown");
  });
});

describe("Logger.child", () => {
  it("inherits the parent numeric level, not the debug constructor default", () => {
    new Logger("info").child({ req: 1 }).debug("filtered-because-parent-is-info");
    expect(writes).toHaveLength(0);
  });

  it("merges its context into entries", () => {
    new Logger("info", { base: 1 }).child({ extra: 2 }).info("m");
    const entry = firstEntry();
    expect(entry.base).toBe(1);
    expect(entry.extra).toBe(2);
  });
});

describe("Logger entry shape", () => {
  it("merges context and data, with data overriding context", () => {
    new Logger("info", { ctx: "a", keep: "yes" }).info("m", { ctx: "b" });
    const entry = firstEntry();
    expect(entry.ctx).toBe("b");
    expect(entry.keep).toBe("yes");
  });

  it("stamps an ISO timestamp", () => {
    new Logger("info").info("m");
    expect(firstEntry().timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("initLogger / getLogger", () => {
  it("return the same singleton", () => {
    const logger = initLogger("debug");
    expect(getLogger()).toBe(logger);
  });

  it("applies the new level to the singleton", () => {
    initLogger("error");
    getLogger().warn("filtered");
    expect(writes).toHaveLength(0);
  });
});
