import { type BaseCheckpointSaver, MemorySaver } from "@langchain/langgraph";
import { NodeSqliteSaver } from "./checkpointer.js";
import { createMemoryStores } from "./memory.js";
import { createSqliteStores, openDatabase } from "./sqlite.js";
import type { Stores } from "./types.js";

export interface Persistence {
  checkpointer: BaseCheckpointSaver;
  stores: Stores;
  /** True when pauses and the nurse queue survive a restart. */
  durable: boolean;
  close(): void;
}

/**
 * One SQLite file holds the graph checkpoints and our own thread/escalation tables, so they stay
 * consistent with each other. With no path everything lives in memory and is lost on restart.
 */
export function createPersistence(databasePath: string | null): Persistence {
  if (databasePath === null) {
    return {
      checkpointer: new MemorySaver(),
      stores: createMemoryStores(),
      durable: false,
      close() {},
    };
  }
  const db = openDatabase(databasePath);
  return {
    checkpointer: new NodeSqliteSaver(db),
    stores: createSqliteStores(db),
    durable: true,
    close: () => db.close(),
  };
}

export type { Stores } from "./types.js";
