import { DatabaseSync } from "node:sqlite";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

// Toolchain canary: node:sqlite (prefix-only builtin) and pino resolve under Vitest and tsc 7.
describe("toolchain", () => {
  it("opens an in-memory node:sqlite database", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t (x) VALUES (?)").run(7);
    expect(db.prepare("SELECT x FROM t").get()).toEqual({ x: 7 });
    db.close();
  });

  it("creates a pino logger", () => {
    expect(typeof pino({ level: "silent" }).info).toBe("function");
  });
});
