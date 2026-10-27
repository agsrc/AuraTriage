import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toApiMessages } from "../src/graph/messages.js";
import { createDemoLlm } from "../src/llm/demo.js";
import { NodeSqliteSaver } from "../src/persistence/checkpointer.js";
import { createPersistence } from "../src/persistence/index.js";
import { createMemoryStores } from "../src/persistence/memory.js";
import { createSqliteStores, openDatabase } from "../src/persistence/sqlite.js";
import type { EscalationRecord, Stores } from "../src/persistence/types.js";
import { createHarness, messagesOf, pendingPayload } from "./support/harness.js";

function escalation(threadId: string, overrides: Partial<EscalationRecord> = {}): EscalationRecord {
  return {
    threadId,
    patientId: "P-1001",
    reason: "red_flag",
    categories: ["chest_pain"],
    status: "pending",
    createdAt: "2026-10-27T12:00:00.000Z",
    ...overrides,
  };
}

const implementations: [string, () => Stores][] = [
  ["memory", () => createMemoryStores()],
  ["sqlite", () => createSqliteStores(new DatabaseSync(":memory:"))],
];

describe.each(implementations)("stores (%s)", (_name, create) => {
  it("remembers who owns a thread and ignores a duplicate create", () => {
    const { threads } = create();

    threads.create({ threadId: "t1", patientId: "P-1001", createdAt: "2026-10-27T12:00:00.000Z" });
    threads.create({ threadId: "t1", patientId: "P-9999", createdAt: "2026-10-27T13:00:00.000Z" });

    expect(threads.get("t1")).toEqual({
      threadId: "t1",
      patientId: "P-1001",
      createdAt: "2026-10-27T12:00:00.000Z",
    });
    expect(threads.get("missing")).toBeUndefined();
  });

  it("keeps one pending escalation per thread", () => {
    const { escalations } = create();

    escalations.openIfAbsent(escalation("t1"));
    escalations.openIfAbsent(escalation("t1", { reason: "high_risk_output", categories: [] }));

    expect(escalations.list("pending")).toHaveLength(1);
    expect(escalations.latest("t1")).toMatchObject({
      reason: "red_flag",
      categories: ["chest_pain"],
      status: "pending",
    });
  });

  it("resolves once, then allows a later escalation on the same thread", () => {
    const { escalations } = create();
    escalations.openIfAbsent(escalation("t1"));

    expect(escalations.markResolved("t1", "2026-10-27T12:05:00.000Z")).toBe(true);
    expect(escalations.markResolved("t1", "2026-10-27T12:06:00.000Z")).toBe(false);
    expect(escalations.latest("t1")).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-10-27T12:05:00.000Z",
    });

    escalations.openIfAbsent(escalation("t1", { createdAt: "2026-10-27T13:00:00.000Z" }));
    expect(escalations.latest("t1")).toMatchObject({
      status: "pending",
      createdAt: "2026-10-27T13:00:00.000Z",
    });
    expect(escalations.list("resolved")).toHaveLength(1);
  });

  it("lists the queue oldest first and the history newest first", () => {
    const { escalations } = create();
    for (const id of ["a", "b", "c"]) escalations.openIfAbsent(escalation(id));
    escalations.markResolved("a", "2026-10-27T12:05:00.000Z");
    escalations.markResolved("b", "2026-10-27T12:06:00.000Z");

    expect(escalations.list("pending").map((r) => r.threadId)).toEqual(["c"]);
    expect(escalations.list("resolved").map((r) => r.threadId)).toEqual(["b", "a"]);
    expect(escalations.list().map((r) => r.threadId)).toEqual(["c", "b", "a"]);
  });
});

describe("durable pauses (node:sqlite checkpointer)", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "auratriage-"));
    file = path.join(dir, "checkpoints.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a paused escalation across a restart and lets a nurse resume it", async () => {
    const first = openDatabase(file);
    const before = createHarness({
      llm: createDemoLlm(),
      checkpointer: new NodeSqliteSaver(first),
    });
    await before.say("I have chest pain");
    expect(pendingPayload(await before.snapshot())).toMatchObject({ reason: "red_flag" });
    first.close();

    // A new process: new connection, new saver, new graph.
    const second = openDatabase(file);
    const after = createHarness({
      llm: createDemoLlm(),
      checkpointer: new NodeSqliteSaver(second),
    });
    const paused = await after.snapshot();
    expect(paused.next).toEqual(["human_escalation"]);
    expect(pendingPayload(paused)).toMatchObject({
      reason: "red_flag",
      categories: ["chest_pain"],
    });

    await after.resume({ decision: "edit", editedReply: "Please come in today." });

    const finished = await after.snapshot();
    expect(finished.next).toEqual([]);
    expect(toApiMessages(messagesOf(finished), "patient").at(-1)).toMatchObject({
      content: "Please come in today.",
    });
    second.close();
  });

  it("runs an ordinary multi-step turn on the SQLite checkpointer", async () => {
    const db = openDatabase(file);
    const h = createHarness({ llm: createDemoLlm(), checkpointer: new NodeSqliteSaver(db) });

    await h.say("I'd like to book a cardiology appointment");
    await h.say("yes please");

    expect(h.calls.map((c) => c.name)).toEqual([
      "ehr_check_provider_availability",
      "ehr_book_appointment",
    ]);
    const history = [];
    for await (const checkpoint of h.graph.getStateHistory({ configurable: { thread_id: "t1" } })) {
      history.push(checkpoint);
    }
    expect(history.length).toBeGreaterThan(3);
    db.close();
  });

  it("deletes a thread's checkpoints", async () => {
    const db = openDatabase(file);
    const saver = new NodeSqliteSaver(db);
    const h = createHarness({ llm: createDemoLlm(), checkpointer: saver });
    await h.say("I have a mild cough");

    await saver.deleteThread("t1");

    expect((await h.snapshot()).values).toEqual({});
    db.close();
  });

  it("createPersistence picks memory or SQLite from the configured path", () => {
    const memory = createPersistence(null);
    expect(memory.durable).toBe(false);
    memory.close();

    const sqlite = createPersistence(file);
    expect(sqlite.durable).toBe(true);
    sqlite.close();
  });
});
