import type { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";

export type ModelReply = AIMessage | AIMessageChunk;

/**
 * The only surface the graph needs from a language model. Keeping it this small means the graph
 * does not care whether Claude, a test double or the offline demo model is behind it.
 */
export interface LlmPort {
  /** Plain completion without tools, used by intake to classify the request. */
  complete(messages: readonly BaseMessage[], config: RunnableConfig): Promise<ModelReply>;
  /** Completion that may answer with tool calls. */
  completeWithTools(
    messages: readonly BaseMessage[],
    tools: readonly StructuredToolInterface[],
    config: RunnableConfig,
  ): Promise<ModelReply>;
}

/** Thrown when the model cannot be reached. The API maps it to 503 `llm_unavailable`. */
export class LlmUnavailableError extends Error {}
