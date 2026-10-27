import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  EscalationReasonSchema,
  type EscalationStatus,
  EscalationStatusSchema,
  RedFlagCategorySchema,
} from "../contracts.js";
import type {
  EscalationRecord,
  EscalationStore,
  Stores,
  ThreadRecord,
  ThreadStore,
} from "./types.js";

/** Opens (and creates) the database file. `node:sqlite` is built in, so there is no native add-on to install. */
export function openDatabase(file: string): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

const ThreadRowSchema = z.object({
  thread_id: z.string(),
  patient_id: z.string(),
  created_at: z.string(),
});

const EscalationRowSchema = z.object({
  thread_id: z.string(),
  patient_id: z.string(),
  reason: EscalationReasonSchema,
  categories: z.string(),
  status: EscalationStatusSchema,
  created_at: z.string(),
  resolved_at: z.string().nullable(),
});

const CategoriesSchema = z.array(RedFlagCategorySchema);

function toEscalationRecord(row: unknown): EscalationRecord {
  const parsed = EscalationRowSchema.parse(row);
  return {
    threadId: parsed.thread_id,
    patientId: parsed.patient_id,
    reason: parsed.reason,
    categories: CategoriesSchema.parse(JSON.parse(parsed.categories)),
    status: parsed.status,
    createdAt: parsed.created_at,
    ...(parsed.resolved_at === null ? {} : { resolvedAt: parsed.resolved_at }),
  };
}

export function createSqliteStores(db: DatabaseSync): Stores {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS escalations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      categories TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_escalation_per_thread
      ON escalations (thread_id) WHERE status = 'pending';
  `);

  const insertThread = db.prepare(
    "INSERT OR IGNORE INTO threads (thread_id, patient_id, created_at) VALUES (?, ?, ?)",
  );
  const selectThread = db.prepare(
    "SELECT thread_id, patient_id, created_at FROM threads WHERE thread_id = ?",
  );
  const insertEscalation = db.prepare(
    `INSERT OR IGNORE INTO escalations (thread_id, patient_id, reason, categories, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  );
  const selectLatest = db.prepare(
    "SELECT * FROM escalations WHERE thread_id = ? ORDER BY id DESC LIMIT 1",
  );
  const selectPending = db.prepare(
    "SELECT * FROM escalations WHERE status = 'pending' ORDER BY id ASC",
  );
  const selectResolved = db.prepare(
    "SELECT * FROM escalations WHERE status = 'resolved' ORDER BY id DESC",
  );
  const selectAll = db.prepare("SELECT * FROM escalations ORDER BY id DESC");
  const resolve = db.prepare(
    "UPDATE escalations SET status = 'resolved', resolved_at = ? WHERE thread_id = ? AND status = 'pending'",
  );

  const threads: ThreadStore = {
    create(record: ThreadRecord) {
      insertThread.run(record.threadId, record.patientId, record.createdAt);
    },
    get(threadId) {
      const row = selectThread.get(threadId);
      if (row === undefined) return undefined;
      const parsed = ThreadRowSchema.parse(row);
      return {
        threadId: parsed.thread_id,
        patientId: parsed.patient_id,
        createdAt: parsed.created_at,
      };
    },
  };

  const escalations: EscalationStore = {
    openIfAbsent(record) {
      insertEscalation.run(
        record.threadId,
        record.patientId,
        record.reason,
        JSON.stringify(record.categories),
        record.createdAt,
      );
    },
    latest(threadId) {
      const row = selectLatest.get(threadId);
      return row === undefined ? undefined : toEscalationRecord(row);
    },
    list(status?: EscalationStatus) {
      const statement =
        status === "pending" ? selectPending : status === "resolved" ? selectResolved : selectAll;
      return statement.all().map(toEscalationRecord);
    },
    markResolved(threadId, resolvedAt) {
      return Number(resolve.run(resolvedAt, threadId).changes) > 0;
    },
  };

  return { threads, escalations };
}
