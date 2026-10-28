import type { RunnableConfig } from "@langchain/core/runnables";
import { isGraphInterrupt } from "@langchain/langgraph";
import { type Attributes, SpanStatusCode, trace } from "@opentelemetry/api";
import { z } from "zod";
import type { RedFlagCategory } from "../contracts.js";
import type { NODES } from "../graph/edges.js";
import type { LlmPort, ModelReply } from "../llm/port.js";

const TRACER_NAME = "auratriage";

export type NodeName = (typeof NODES)[keyof typeof NODES];

/**
 * Everything a span may carry. This is the allowlist: there is no field for message text, tool
 * arguments, tool results, names or dates of birth, so none of them can be attached by accident.
 * Strings here are opaque IDs, fixed codes or names of our own code. The `openinference.*` and
 * `llm.*` keys follow the OpenInference conventions, which is what lets Phoenix draw a nice view.
 */
export interface SafeAttributes {
  "openinference.span.kind"?: "CHAIN" | "LLM" | "TOOL";
  "triage.node"?: NodeName;
  "triage.thread_id"?: string;
  "triage.patient_id"?: string;
  "triage.intent"?: "triage" | "booking";
  "triage.red_flag"?: boolean;
  "triage.red_flag_categories"?: readonly RedFlagCategory[];
  "triage.interrupted"?: boolean;
  "triage.decision"?: "approve" | "edit" | "reject";
  "llm.model_name"?: string;
  "llm.token_count.prompt"?: number;
  "llm.token_count.completion"?: number;
  "llm.tool_call_count"?: number;
  "tool.name"?: string;
  "error.type"?: string;
}

export interface SafeSpan {
  set(attributes: SafeAttributes): void;
}

/** Drops unset values and copies arrays, which is the shape the OpenTelemetry API wants. */
function toAttributes(attributes: SafeAttributes): Attributes {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    result[key] = Array.isArray(value) ? [...value] : value;
  }
  return result;
}

/** The class name only: error messages can carry user text. */
function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Runs `fn` inside a span. With no tracing provider registered the tracer is a no-op, so callers
 * never need to check whether tracing is on. A LangGraph interrupt is a pause, not a failure.
 */
export function withSpan<T>(
  name: string,
  attributes: SafeAttributes,
  fn: (span: SafeSpan) => Promise<T> | T,
): Promise<T> {
  return trace.getTracer(TRACER_NAME).startActiveSpan(name, async (span) => {
    span.setAttributes(toAttributes(attributes));
    try {
      return await fn({ set: (more) => span.setAttributes(toAttributes(more)) });
    } catch (error) {
      if (isGraphInterrupt(error)) {
        span.setAttribute("triage.interrupted", true);
      } else {
        span.setAttribute("error.type", errorType(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

const RunIdsSchema = z.object({
  thread_id: z.string().optional(),
  patientId: z.string().optional(),
});

function idsOf(config: RunnableConfig): SafeAttributes {
  const ids = RunIdsSchema.safeParse(config.configurable ?? {});
  if (!ids.success) return {};
  return { "triage.thread_id": ids.data.thread_id, "triage.patient_id": ids.data.patientId };
}

/** Wraps a graph node so each run is a span. `describe` may add attributes from what it returned. */
export function tracedNode<S, U>(
  name: NodeName,
  node: (state: S, config: RunnableConfig) => U | Promise<U>,
  describe?: (update: U) => SafeAttributes,
): (state: S, config: RunnableConfig) => Promise<U> {
  return (state, config) =>
    withSpan(
      `node.${name}`,
      { "openinference.span.kind": "CHAIN", "triage.node": name, ...idsOf(config) },
      async (span) => {
        const update = await node(state, config);
        if (describe !== undefined) span.set(describe(update));
        return update;
      },
    );
}

function describeReply(reply: ModelReply): SafeAttributes {
  return {
    "llm.tool_call_count": reply.tool_calls?.length ?? 0,
    "llm.token_count.prompt": reply.usage_metadata?.input_tokens,
    "llm.token_count.completion": reply.usage_metadata?.output_tokens,
  };
}

/** Records timing, model name, token counts and the number of tool calls, never the text. */
export function withLlmTracing(llm: LlmPort, modelName: string): LlmPort {
  const base: SafeAttributes = { "openinference.span.kind": "LLM", "llm.model_name": modelName };
  return {
    complete: (messages, config) =>
      withSpan("llm.complete", { ...base, ...idsOf(config) }, async (span) => {
        const reply = await llm.complete(messages, config);
        span.set(describeReply(reply));
        return reply;
      }),
    completeWithTools: (messages, tools, config) =>
      withSpan("llm.complete_with_tools", { ...base, ...idsOf(config) }, async (span) => {
        const reply = await llm.completeWithTools(messages, tools, config);
        span.set(describeReply(reply));
        return reply;
      }),
  };
}
