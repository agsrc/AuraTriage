import { AIMessage, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { messagesOf, pendingEscalation } from "../src/chat/snapshot.js";
import type { TriageGraph } from "../src/graph/build.js";
import { humanMessage, toApiMessages } from "../src/graph/messages.js";
import type { LlmPort } from "../src/llm/port.js";
import { EMERGENCY_NOTICE } from "../src/safety/redFlags.js";
import { withSpan } from "../src/telemetry/spans.js";
import type { CaseRecord, EvalCase, ToolCallRecord, TurnRecord } from "./model.js";

/** Same bound the chat service uses, so a looping model fails here the way it would for a patient. */
const RECURSION_LIMIT = 12;

/** Results the graph itself produces when it refuses a call (see `toolExecution`). */
const REFUSED = /^(Booking refused|This tool is not available)/;

export type CountedLlm = LlmPort & { readonly calls: number };

/** Counts model calls so a case can assert that the red-flag path made none. */
export function countingLlm(inner: LlmPort): CountedLlm {
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

function toolCallsIn(fresh: readonly BaseMessage[]): ToolCallRecord[] {
  const results = new Map<string, ToolMessage>();
  for (const message of fresh) {
    if (ToolMessage.isInstance(message)) results.set(message.tool_call_id, message);
  }
  const records: ToolCallRecord[] = [];
  for (const message of fresh) {
    if (!AIMessage.isInstance(message)) continue;
    for (const call of message.tool_calls ?? []) {
      const result = call.id === undefined ? undefined : results.get(call.id);
      const outcome =
        result === undefined
          ? "pending"
          : result.status !== "error"
            ? "ok"
            : REFUSED.test(result.text)
              ? "refused"
              : "error";
      records.push({ name: call.name, args: call.args, outcome });
    }
  }
  return records;
}

async function runTurn(
  graph: TriageGraph,
  llm: CountedLlm,
  config: RunnableConfig,
  patientText: string,
): Promise<TurnRecord> {
  const before = messagesOf(await graph.getState(config)).length;
  const callsBefore = llm.calls;
  const started = performance.now();
  let error: string | undefined;
  try {
    // A span per turn, so an eval run shows up in Phoenix when tracing is on. IDs only.
    await withSpan(
      "eval.turn",
      {
        "openinference.span.kind": "CHAIN",
        "triage.thread_id": config.configurable?.thread_id,
        "triage.patient_id": config.configurable?.patientId,
      },
      () => graph.invoke({ messages: [humanMessage(patientText, new Date())] }, config),
    );
  } catch (caught) {
    error = caught instanceof Error ? caught.name : "unknown";
  }
  const ms = Math.round(performance.now() - started);

  const snapshot = await graph.getState(config);
  const fresh = messagesOf(snapshot).slice(before);
  const visible = toApiMessages(fresh, "patient").filter((message) => message.role !== "patient");
  const paused = pendingEscalation(snapshot);
  return {
    patientText,
    toolCalls: toolCallsIn(fresh),
    reply: visible.findLast((message) => message.role === "assistant")?.content,
    emergencyNotice: visible.some(
      (message) => message.role === "system" && message.content === EMERGENCY_NOTICE,
    ),
    ...(paused === undefined
      ? {}
      : { paused: { reason: paused.reason, categories: paused.categories } }),
    modelCalls: llm.calls - callsBefore,
    ...(error === undefined ? {} : { error }),
    ms,
  };
}

/** Plays a case's messages in one conversation, stopping early if it pauses or fails. */
export async function runCase(
  graph: TriageGraph,
  llm: CountedLlm,
  evalCase: EvalCase,
  run: number,
): Promise<CaseRecord> {
  const config: RunnableConfig = {
    configurable: { thread_id: `eval-${evalCase.id}-${run}`, patientId: evalCase.patientId },
    recursionLimit: RECURSION_LIMIT,
  };
  const turns: TurnRecord[] = [];
  for (const text of evalCase.turns) {
    const turn = await runTurn(graph, llm, config, text);
    turns.push(turn);
    if (turn.paused !== undefined || turn.error !== undefined) break;
  }
  return { caseId: evalCase.id, turns };
}
