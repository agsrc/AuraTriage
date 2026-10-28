import { randomUUID } from "node:crypto";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Command } from "@langchain/langgraph";
import type {
  ChatRequest,
  ChatResponse,
  EscalationDetail,
  EscalationStatus,
  EscalationSummary,
  NurseResolution,
  ResolveResponse,
  ThreadResponse,
} from "../contracts.js";
import { ApiHttpError, conflict, notFound } from "../errors.js";
import type { TriageGraph } from "../graph/build.js";
import { humanMessage, toApiMessages } from "../graph/messages.js";
import { LlmUnavailableError } from "../llm/port.js";
import type { Logger } from "../logger.js";
import type { EscalationRecord, Stores } from "../persistence/types.js";
import { EMERGENCY_NOTICE } from "../safety/redFlags.js";
import { withSpan } from "../telemetry/spans.js";
import { messagesOf, pendingEscalation } from "./snapshot.js";

/** Upper bound on graph steps per turn, so a looping model cannot run forever. */
const RECURSION_LIMIT = 12;

export interface ChatServiceDeps {
  graph: TriageGraph;
  stores: Stores;
  logger: Logger;
  now: () => Date;
}

/**
 * The rules around the graph: who may touch which conversation, what a turn returns, and the
 * nurse queue. It never logs message text, only opaque IDs, reasons and category codes.
 */
export class ChatService {
  private readonly graph: TriageGraph;
  private readonly stores: Stores;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly busy = new Set<string>();

  constructor(deps: ChatServiceDeps) {
    this.graph = deps.graph;
    this.stores = deps.stores;
    this.logger = deps.logger;
    this.now = deps.now;
  }

  async sendMessage(patientId: string, request: ChatRequest): Promise<ChatResponse> {
    const threadId = request.threadId ?? randomUUID();
    if (request.threadId === undefined) {
      this.stores.threads.create({ threadId, patientId, createdAt: this.now().toISOString() });
    } else {
      this.requireOwnedThread(patientId, threadId);
    }

    return this.withThreadLock(threadId, async () => {
      const config = runConfig(threadId, patientId);
      const before = await this.graph.getState(config);
      if (pendingEscalation(before) !== undefined) {
        throw conflict("This conversation is waiting for a nurse to respond.");
      }
      const countBefore = messagesOf(before).length;

      try {
        await withSpan(
          "chat.turn",
          {
            "openinference.span.kind": "CHAIN",
            "triage.thread_id": threadId,
            "triage.patient_id": patientId,
          },
          () =>
            this.graph.invoke({ messages: [humanMessage(request.message, this.now())] }, config),
        );
      } catch (error) {
        throw this.translate(error);
      }

      const after = await this.graph.getState(config);
      const paused = pendingEscalation(after);
      if (paused !== undefined) {
        this.stores.escalations.openIfAbsent({
          threadId,
          patientId,
          reason: paused.reason,
          categories: paused.categories,
          status: "pending",
          createdAt: this.now().toISOString(),
        });
        this.logger.info(
          {
            event: "escalation_opened",
            threadId,
            reason: paused.reason,
            categories: paused.categories,
          },
          "escalation opened",
        );
      }

      const produced = toApiMessages(messagesOf(after).slice(countBefore), "patient").filter(
        (message) => message.role !== "patient",
      );
      return {
        threadId,
        status: paused === undefined ? "responded" : "awaiting_nurse",
        messages: produced,
        ...(paused?.reason === "red_flag" ? { emergencyNotice: EMERGENCY_NOTICE } : {}),
      };
    });
  }

  async getThread(patientId: string, threadId: string): Promise<ThreadResponse> {
    this.requireOwnedThread(patientId, threadId);
    const snapshot = await this.graph.getState(runConfig(threadId, patientId));
    return {
      threadId,
      status: pendingEscalation(snapshot) === undefined ? "responded" : "awaiting_nurse",
      messages: toApiMessages(messagesOf(snapshot), "patient"),
    };
  }

  listEscalations(status?: EscalationStatus): EscalationSummary[] {
    return this.stores.escalations.list(status).map(toSummary);
  }

  async getEscalation(threadId: string): Promise<EscalationDetail> {
    const record = this.stores.escalations.latest(threadId);
    if (record === undefined) {
      throw notFound("Escalation");
    }
    const snapshot = await this.graph.getState(runConfig(threadId, record.patientId));
    const pending = pendingEscalation(snapshot);
    return {
      ...toSummary(record),
      transcript: toApiMessages(messagesOf(snapshot), "nurse"),
      ...(pending?.concern === undefined ? {} : { concern: pending.concern }),
      ...(pending?.proposedReply === undefined ? {} : { proposedReply: pending.proposedReply }),
    };
  }

  async resolve(threadId: string, resolution: NurseResolution): Promise<ResolveResponse> {
    const record = this.stores.escalations.latest(threadId);
    if (record === undefined) {
      throw notFound("Escalation");
    }

    return this.withThreadLock(threadId, async () => {
      const current = this.stores.escalations.latest(threadId);
      if (current === undefined || current.status !== "pending") {
        throw conflict("This escalation has already been resolved.");
      }
      const config = runConfig(threadId, current.patientId);
      if (pendingEscalation(await this.graph.getState(config)) === undefined) {
        throw conflict("This conversation is no longer waiting for a nurse.");
      }

      try {
        await withSpan(
          "chat.resolve",
          {
            "openinference.span.kind": "CHAIN",
            "triage.thread_id": threadId,
            "triage.patient_id": current.patientId,
            "triage.decision": resolution.decision,
          },
          () => this.graph.invoke(new Command({ resume: resolution }), config),
        );
      } catch (error) {
        throw this.translate(error);
      }
      this.stores.escalations.markResolved(threadId, this.now().toISOString());
      this.logger.info(
        { event: "escalation_resolved", threadId, decision: resolution.decision },
        "escalation resolved",
      );
      return { threadId, status: "resolved" };
    });
  }

  /** A patient only ever sees their own conversations; anything else is "not found" so IDs cannot be probed. */
  private requireOwnedThread(patientId: string, threadId: string): void {
    const thread = this.stores.threads.get(threadId);
    if (thread === undefined || thread.patientId !== patientId) {
      throw notFound("Conversation");
    }
  }

  private async withThreadLock<T>(threadId: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(threadId)) {
      throw conflict("This conversation is busy. Please try again in a moment.");
    }
    this.busy.add(threadId);
    try {
      return await work();
    } finally {
      this.busy.delete(threadId);
    }
  }

  private translate(error: unknown): Error {
    if (error instanceof ApiHttpError) {
      return error;
    }
    if (error instanceof LlmUnavailableError) {
      return new ApiHttpError(
        503,
        "llm_unavailable",
        "The assistant is temporarily unavailable. Please try again.",
      );
    }
    return error instanceof Error ? error : new Error("Unexpected failure");
  }
}

function runConfig(threadId: string, patientId: string): RunnableConfig {
  return { configurable: { thread_id: threadId, patientId }, recursionLimit: RECURSION_LIMIT };
}

function toSummary(record: EscalationRecord): EscalationSummary {
  return {
    threadId: record.threadId,
    patientId: record.patientId,
    reason: record.reason,
    categories: record.categories,
    status: record.status,
    createdAt: record.createdAt,
  };
}
