import { AIMessage, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { type BaseCheckpointSaver, Command, MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import type { NurseResolution } from "../../src/contracts.js";
import { buildTriageGraph } from "../../src/graph/build.js";
import { humanMessage } from "../../src/graph/messages.js";
import type { GraphDeps, RiskClassifier } from "../../src/graph/nodes.js";
import type { LlmPort } from "../../src/llm/port.js";
import { EHR_TOOL, type EhrTools } from "../../src/mcp/ehr.js";
import type { PatientHistorySummary } from "../../src/mcp/schemas.js";

export const FIXED_NOW = new Date("2026-10-27T12:00:00Z");

export const STABLE_HISTORY: PatientHistorySummary = {
  patientId: "P-1002",
  ageBand: "30-39",
  conditions: ["asthma"],
  medications: [],
  allergies: [],
  recentEncounters: [],
  episodesOfCare: [],
  vitalsTrends: [
    { metric: "systolic_bp", direction: "stable", windowSize: 3 },
    { metric: "heart_rate", direction: "stable", windowSize: 3 },
  ],
};

export const RISING_BP_HISTORY: PatientHistorySummary = {
  ...STABLE_HISTORY,
  patientId: "P-1001",
  vitalsTrends: [
    { metric: "systolic_bp", direction: "rising", windowSize: 3 },
    { metric: "heart_rate", direction: "stable", windowSize: 3 },
  ],
};

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  /** What the hook would have bound: the patient ID in the run config. */
  sessionPatientId: unknown;
}

export interface FakeEhrOptions {
  history?: PatientHistorySummary;
  failHistory?: boolean;
}

/** EHR tools that record every call, so tests can see what the graph really invoked. */
export function fakeEhrTools(options: FakeEhrOptions = {}) {
  const calls: ToolCallRecord[] = [];
  const record = (
    name: string,
    args: Record<string, unknown>,
    config: RunnableConfig | undefined,
  ) => {
    calls.push({ name, args, sessionPatientId: config?.configurable?.patientId });
  };

  const tools: EhrTools = {
    [EHR_TOOL.history]: tool(
      async (args, config) => {
        record(EHR_TOOL.history, args, config);
        if (options.failHistory) throw new Error("EHR is down");
        return JSON.stringify(options.history ?? STABLE_HISTORY);
      },
      {
        name: EHR_TOOL.history,
        description: "history",
        schema: z.object({ patientId: z.string() }),
      },
    ),
    [EHR_TOOL.availability]: tool(
      async (args, config) => {
        record(EHR_TOOL.availability, args, config);
        return JSON.stringify({
          specialty: args.specialty,
          slots: [
            {
              slotId: "S-1001",
              providerId: "D-2003",
              providerName: "Dr. Soraya Lindqvist",
              start: "2026-10-28T09:00:00Z",
              durationMinutes: 30,
            },
          ],
        });
      },
      {
        name: EHR_TOOL.availability,
        description: "availability",
        schema: z.object({ specialty: z.string() }),
      },
    ),
    [EHR_TOOL.book]: tool(
      async (args, config) => {
        record(EHR_TOOL.book, args, config);
        return JSON.stringify({ status: "booked", appointmentId: "A-0001", slotId: args.slotId });
      },
      {
        name: EHR_TOOL.book,
        description: "book",
        schema: z.object({ patientId: z.string(), slotId: z.string() }),
      },
    ),
  };
  return { tools, calls };
}

/** Wraps a model and counts how often it was asked anything. */
export function countingLlm(inner: LlmPort): LlmPort & { readonly calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    complete: (messages, config) => {
      calls++;
      return inner.complete(messages, config);
    },
    completeWithTools: (messages, tools, config) => {
      calls++;
      return inner.completeWithTools(messages, tools, config);
    },
  };
}

/** A model that always fails, as when the provider is down. */
export function failingLlm(error: Error): LlmPort {
  return {
    complete: () => Promise.reject(error),
    completeWithTools: () => Promise.reject(error),
  };
}

/** Intake answers `intent`; agent steps come from a queue, one reply per model call. */
export function scriptedLlm(
  intent: "triage" | "booking",
  replies: AIMessage[],
): LlmPort & { readonly remaining: number } {
  const queue = [...replies];
  return {
    get remaining() {
      return queue.length;
    },
    complete: async () => new AIMessage(intent),
    completeWithTools: async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error("scripted model ran out of replies");
      return next;
    },
  };
}

export function toolCall(
  name: string,
  args: Record<string, unknown>,
  id = `call_${name}`,
): AIMessage {
  return new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }] });
}

export interface HarnessOptions {
  llm: LlmPort;
  history?: PatientHistorySummary;
  failHistory?: boolean;
  riskClassifier?: RiskClassifier;
  checkpointer?: BaseCheckpointSaver;
}

export function createHarness(options: HarnessOptions) {
  const { tools, calls } = fakeEhrTools({
    history: options.history,
    failHistory: options.failHistory,
  });
  const deps: GraphDeps = {
    llm: options.llm,
    tools,
    riskClassifier: options.riskClassifier,
    now: () => FIXED_NOW,
  };
  const graph = buildTriageGraph(deps, options.checkpointer ?? new MemorySaver());

  const config = (threadId: string, patientId: string): RunnableConfig => ({
    configurable: { thread_id: threadId, patientId },
    recursionLimit: 12,
  });

  return {
    graph,
    calls,
    say: (text: string, threadId = "t1", patientId = "P-1001") =>
      graph.invoke({ messages: [humanMessage(text, FIXED_NOW)] }, config(threadId, patientId)),
    resume: (resolution: NurseResolution, threadId = "t1", patientId = "P-1001") =>
      graph.invoke(new Command({ resume: resolution }), config(threadId, patientId)),
    snapshot: (threadId = "t1") => graph.getState(config(threadId, "P-1001")),
  };
}

// The tests read snapshots exactly the way the chat service does.
export { messagesOf, pendingEscalation as pendingPayload } from "../../src/chat/snapshot.js";

/** Every tool call must have a matching result, otherwise the next model request would be rejected. */
export function unansweredToolCallIds(messages: readonly BaseMessage[]): string[] {
  const answered = new Set(
    messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message.tool_call_id),
  );
  return messages
    .filter((message) => AIMessage.isInstance(message))
    .flatMap((message) => message.tool_calls ?? [])
    .map((call) => call.id ?? "")
    .filter((id) => !answered.has(id));
}
