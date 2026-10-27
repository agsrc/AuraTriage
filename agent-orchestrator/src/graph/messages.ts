import { AIMessage, type BaseMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ChatMessage } from "../contracts.js";
import type { ModelReply } from "../llm/port.js";

// Fixed texts sent after a nurse decides. They are static on purpose: no model is involved.
export const NURSE_APPROVED_RED_FLAG_TEXT =
  "A nurse has reviewed your message and will follow up with you. If you are having an emergency, call 911 now.";
export const NURSE_APPROVED_GENERIC_TEXT =
  "A nurse has reviewed your message. Please follow the guidance you were given.";
export const NURSE_REJECTED_TEXT =
  "A nurse has reviewed your message. A member of our care team will contact you directly. " +
  "If you feel worse, call your local emergency number.";

/** Messages that belong to the transcript but must never be shown to the model. */
const MetaSchema = z.object({
  aura_kind: z.enum(["emergency_notice", "nurse_note"]).optional(),
  created_at: z.string().optional(),
});
type Meta = z.infer<typeof MetaSchema>;

const EPOCH = new Date(0).toISOString();

function metaOf(message: BaseMessage): Meta {
  const parsed = MetaSchema.safeParse(message.additional_kwargs);
  return parsed.success ? parsed.data : {};
}

export function humanMessage(text: string, now: Date): HumanMessage {
  return new HumanMessage({ content: text, additional_kwargs: { created_at: now.toISOString() } });
}

export function assistantMessage(text: string, now: Date): AIMessage {
  return new AIMessage({ content: text, additional_kwargs: { created_at: now.toISOString() } });
}

export function emergencyNoticeMessage(text: string, now: Date): AIMessage {
  return new AIMessage({
    content: text,
    additional_kwargs: { aura_kind: "emergency_notice", created_at: now.toISOString() },
  });
}

export function nurseNoteMessage(text: string, now: Date): AIMessage {
  return new AIMessage({
    content: text,
    additional_kwargs: { aura_kind: "nurse_note", created_at: now.toISOString() },
  });
}

/** Copies a model reply into a plain AIMessage with a timestamp so the transcript can show when it was sent. */
export function stampReply(reply: ModelReply, now: Date): AIMessage {
  return new AIMessage({
    content: reply.content,
    tool_calls: reply.tool_calls,
    invalid_tool_calls: reply.invalid_tool_calls,
    response_metadata: reply.response_metadata,
    usage_metadata: reply.usage_metadata,
    additional_kwargs: { ...reply.additional_kwargs, created_at: now.toISOString() },
  });
}

export function latestHumanText(messages: readonly BaseMessage[]): string {
  const last = messages.findLast((message) => message.type === "human");
  return last ? last.text : "";
}

export function humanTurnCount(messages: readonly BaseMessage[]): number {
  return messages.filter((message) => message.type === "human").length;
}

export function lastAiMessage(messages: readonly BaseMessage[]): AIMessage | undefined {
  const last = messages.findLast((message) => AIMessage.isInstance(message));
  return last && AIMessage.isInstance(last) ? last : undefined;
}

/** What the model may see: everything except the emergency notice and nurse notes. */
export function modelMessages(messages: readonly BaseMessage[]): BaseMessage[] {
  return messages.filter((message) => metaOf(message).aura_kind === undefined);
}

/** Tool output is a string or a list of content blocks; the model only needs the text. */
export function textOfOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output)) {
    return output
      .map((block: unknown) => {
        if (typeof block === "string") return block;
        const text = z.object({ text: z.string() }).safeParse(block);
        return text.success ? text.data.text : "";
      })
      .join("");
  }
  return JSON.stringify(output);
}

export type TranscriptView = "patient" | "nurse";

/**
 * Turns the graph's messages into the API's transcript. Tool traffic and AI turns that only
 * request tools are hidden; nurse notes are shown to nurses only.
 */
export function toApiMessages(
  messages: readonly BaseMessage[],
  view: TranscriptView,
): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const [index, message] of messages.entries()) {
    const meta = metaOf(message);
    const base = { id: message.id ?? `m${index}`, createdAt: meta.created_at ?? EPOCH };
    if (message.type === "human") {
      result.push({ ...base, role: "patient", content: message.text });
    } else if (AIMessage.isInstance(message)) {
      if (meta.aura_kind === "nurse_note") {
        if (view === "nurse") result.push({ ...base, role: "nurse", content: message.text });
      } else if (meta.aura_kind === "emergency_notice") {
        result.push({ ...base, role: "system", content: message.text });
      } else if (message.tool_calls === undefined || message.tool_calls.length === 0) {
        if (message.text.trim() !== "")
          result.push({ ...base, role: "assistant", content: message.text });
      }
    }
  }
  return result;
}
