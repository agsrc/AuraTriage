import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  compareWritesSortKeys,
  copyCheckpoint,
  type PendingWrite,
  type SerializerProtocol,
  WRITES_IDX_MAP,
  writesSortKey,
} from "@langchain/langgraph-checkpoint";
import { z } from "zod";

/**
 * LangGraph checkpointer on Node's built-in `node:sqlite`, ported from the official
 * `@langchain/langgraph-checkpoint-sqlite` (which needs the native `better-sqlite3` and so can
 * break `npm ci` on a new Node or CPU). Same schema and semantics, minus legacy-database
 * migrations and metadata filters. Durable pauses are what let a nurse resolve an escalation
 * after the orchestrator restarts.
 */

const CheckpointRowSchema = z.object({
  thread_id: z.string(),
  checkpoint_ns: z.string(),
  checkpoint_id: z.string(),
  parent_checkpoint_id: z.string().nullable(),
  type: z.string().nullable(),
  checkpoint: z.instanceof(Uint8Array),
  metadata: z.instanceof(Uint8Array),
  pending_writes: z.string(),
});

const PendingWriteColumnsSchema = z.array(
  z.object({
    task_id: z.string(),
    channel: z.string(),
    type: z.string().nullable(),
    value: z.string().nullable(),
    task_path: z.string(),
    idx: z.number(),
  }),
);

const SELECT_CHECKPOINT = `
  SELECT
    thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata,
    (
      SELECT json_group_array(json_object(
        'task_id', pw.task_id,
        'channel', pw.channel,
        'type', pw.type,
        'value', CAST(pw.value AS TEXT),
        'task_path', pw.task_path,
        'idx', pw.idx
      ))
      FROM writes AS pw
      WHERE pw.thread_id = checkpoints.thread_id
        AND pw.checkpoint_ns = checkpoints.checkpoint_ns
        AND pw.checkpoint_id = checkpoints.checkpoint_id
    ) AS pending_writes
  FROM checkpoints`;

export class NodeSqliteSaver extends BaseCheckpointSaver {
  private readonly db: DatabaseSync;
  private readonly selectLatest: StatementSync;
  private readonly selectById: StatementSync;
  private readonly insertCheckpoint: StatementSync;
  private readonly deleteCheckpoints: StatementSync;
  private readonly deleteWrites: StatementSync;

  constructor(db: DatabaseSync, serde?: SerializerProtocol) {
    super(serde);
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BLOB,
        metadata BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_path TEXT NOT NULL DEFAULT '',
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `);
    this.selectLatest = db.prepare(
      `${SELECT_CHECKPOINT} WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1`,
    );
    this.selectById = db.prepare(
      `${SELECT_CHECKPOINT} WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
    );
    this.insertCheckpoint = db.prepare(
      `INSERT OR REPLACE INTO checkpoints
       (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteCheckpoints = db.prepare("DELETE FROM checkpoints WHERE thread_id = ?");
    this.deleteWrites = db.prepare("DELETE FROM writes WHERE thread_id = ?");
  }

  private transaction(work: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private async toTuple(
    rawRow: unknown,
    namespace: string,
    configured: RunnableConfig | undefined,
  ): Promise<CheckpointTuple> {
    const row = CheckpointRowSchema.parse(rawRow);
    const columns = PendingWriteColumnsSchema.parse(JSON.parse(row.pending_writes));
    const ordered = columns
      .map((column) => ({
        column,
        key: writesSortKey(column.task_path, column.task_id, column.idx),
      }))
      .sort((a, b) => compareWritesSortKeys(a.key, b.key));
    const pendingWrites = await Promise.all(
      ordered.map(
        async ({ column }): Promise<[string, string, unknown]> => [
          column.task_id,
          column.channel,
          await this.serde.loadsTyped(column.type ?? "json", column.value ?? ""),
        ],
      ),
    );
    const checkpoint: Checkpoint = await this.serde.loadsTyped(row.type ?? "json", row.checkpoint);
    if (checkpoint.v < 4) {
      throw new Error("Unsupported legacy checkpoint version");
    }
    const metadata: CheckpointMetadata = await this.serde.loadsTyped(
      row.type ?? "json",
      row.metadata,
    );
    return {
      checkpoint,
      metadata,
      config: configured?.configurable?.checkpoint_id
        ? configured
        : {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: namespace,
              checkpoint_id: row.checkpoint_id,
            },
          },
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: namespace,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {};
    const row = checkpoint_id
      ? this.selectById.get(thread_id, checkpoint_ns, checkpoint_id)
      : this.selectLatest.get(thread_id, checkpoint_ns);
    return row === undefined ? undefined : this.toTuple(row, checkpoint_ns, config);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { limit, before, filter } = options ?? {};
    if (filter !== undefined && Object.keys(filter).length > 0) {
      throw new Error("NodeSqliteSaver does not support metadata filters");
    }
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    const threadId: unknown = config.configurable?.thread_id;
    const namespace: unknown = config.configurable?.checkpoint_ns;
    const beforeId: unknown = before?.configurable?.checkpoint_id;
    if (typeof threadId === "string") {
      conditions.push("thread_id = ?");
      params.push(threadId);
    }
    if (typeof namespace === "string") {
      conditions.push("checkpoint_ns = ?");
      params.push(namespace);
    }
    if (typeof beforeId === "string") {
      conditions.push("checkpoint_id < ?");
      params.push(beforeId);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const cap = limit === undefined ? "" : ` LIMIT ${Math.max(0, Math.trunc(limit))}`;
    const rows = this.db
      .prepare(`${SELECT_CHECKPOINT}${where} ORDER BY checkpoint_id DESC${cap}`)
      .all(...params);
    for (const row of rows) {
      const parsed = CheckpointRowSchema.pick({ checkpoint_ns: true }).parse(row);
      yield await this.toTuple(row, parsed.checkpoint_ns, undefined);
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId: unknown = config.configurable?.thread_id;
    if (typeof threadId !== "string" || threadId === "") {
      throw new Error('Missing "thread_id" field in passed "config.configurable".');
    }
    const namespace: string = config.configurable?.checkpoint_ns ?? "";
    const parentId: string | undefined = config.configurable?.checkpoint_id;
    const [[type, serializedCheckpoint], [metadataType, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
      this.serde.dumpsTyped(metadata),
    ]);
    if (type !== metadataType) {
      throw new Error("Failed to serialize checkpoint and metadata to the same type.");
    }
    this.insertCheckpoint.run(
      threadId,
      namespace,
      checkpoint.id,
      parentId ?? null,
      type,
      serializedCheckpoint,
      serializedMetadata,
    );
    return {
      configurable: { thread_id: threadId, checkpoint_ns: namespace, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath = "",
  ): Promise<void> {
    const threadId: unknown = config.configurable?.thread_id;
    const checkpointId: unknown = config.configurable?.checkpoint_id;
    if (typeof threadId !== "string" || threadId === "") {
      throw new Error("Missing thread_id field in config.configurable.");
    }
    if (typeof checkpointId !== "string" || checkpointId === "") {
      throw new Error("Missing checkpoint_id field in config.configurable.");
    }
    const namespace: string = config.configurable?.checkpoint_ns ?? "";
    const allSpecial = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const insert = this.db.prepare(
      `INSERT ${allSpecial ? "OR REPLACE" : "OR IGNORE"} INTO writes
       (thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, type, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const serialized = await Promise.all(
      writes.map(async ([channel, value], position) => {
        const [type, bytes] = await this.serde.dumpsTyped(value);
        return { channel, type, bytes, idx: WRITES_IDX_MAP[channel] ?? position };
      }),
    );
    this.transaction(() => {
      for (const write of serialized) {
        insert.run(
          threadId,
          namespace,
          checkpointId,
          taskId,
          taskPath,
          write.idx,
          write.channel,
          write.type,
          write.bytes,
        );
      }
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    this.transaction(() => {
      this.deleteCheckpoints.run(threadId);
      this.deleteWrites.run(threadId);
    });
  }
}
