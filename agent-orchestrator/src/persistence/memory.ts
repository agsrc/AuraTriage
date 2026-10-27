import type { EscalationStatus } from "../contracts.js";
import type {
  EscalationRecord,
  EscalationStore,
  Stores,
  ThreadRecord,
  ThreadStore,
} from "./types.js";

class MemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, ThreadRecord>();

  create(record: ThreadRecord): void {
    if (!this.threads.has(record.threadId)) {
      this.threads.set(record.threadId, { ...record });
    }
  }

  get(threadId: string): ThreadRecord | undefined {
    const record = this.threads.get(threadId);
    return record === undefined ? undefined : { ...record };
  }
}

class MemoryEscalationStore implements EscalationStore {
  private readonly records: EscalationRecord[] = [];

  openIfAbsent(record: EscalationRecord): void {
    const pending = this.records.some(
      (r) => r.threadId === record.threadId && r.status === "pending",
    );
    if (!pending) {
      this.records.push({ ...record, categories: [...record.categories] });
    }
  }

  latest(threadId: string): EscalationRecord | undefined {
    const record = this.records.findLast((r) => r.threadId === threadId);
    return record === undefined ? undefined : { ...record };
  }

  list(status?: EscalationStatus): EscalationRecord[] {
    const matching = this.records.filter((r) => status === undefined || r.status === status);
    const ordered = status === "pending" ? matching : matching.toReversed();
    return ordered.map((r) => ({ ...r }));
  }

  markResolved(threadId: string, resolvedAt: string): boolean {
    const record = this.records.find((r) => r.threadId === threadId && r.status === "pending");
    if (record === undefined) {
      return false;
    }
    record.status = "resolved";
    record.resolvedAt = resolvedAt;
    return true;
  }
}

export function createMemoryStores(): Stores {
  return { threads: new MemoryThreadStore(), escalations: new MemoryEscalationStore() };
}
