import type { EscalationReason, EscalationStatus, RedFlagCategory } from "../contracts.js";

export interface ThreadRecord {
  threadId: string;
  patientId: string;
  createdAt: string;
}

export interface EscalationRecord {
  threadId: string;
  patientId: string;
  reason: EscalationReason;
  categories: RedFlagCategory[];
  status: EscalationStatus;
  createdAt: string;
  resolvedAt?: string;
}

/**
 * Who owns each conversation. LangGraph keeps the messages; it has no notion of the patient.
 * The interfaces are synchronous because the MVP is a single process on SQLite.
 */
export interface ThreadStore {
  create(record: ThreadRecord): void;
  get(threadId: string): ThreadRecord | undefined;
}

/**
 * The nurse queue. LangGraph cannot list paused runs across threads, so every escalation is also
 * recorded here. A thread has at most one pending escalation at a time but may have many resolved ones.
 */
export interface EscalationStore {
  /** Records a pending escalation unless the thread already has one. */
  openIfAbsent(record: EscalationRecord): void;
  /** The newest escalation for the thread, pending or resolved. */
  latest(threadId: string): EscalationRecord | undefined;
  /** Pending ones oldest first, resolved ones newest first. */
  list(status?: EscalationStatus): EscalationRecord[];
  /** Returns false if there was no pending escalation to resolve. */
  markResolved(threadId: string, resolvedAt: string): boolean;
}

export interface Stores {
  threads: ThreadStore;
  escalations: EscalationStore;
}
