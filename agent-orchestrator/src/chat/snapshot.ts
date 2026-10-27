import { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { TriageGraph } from "../graph/build.js";
import { type EscalationPayload, EscalationPayloadSchema } from "../graph/state.js";

export type GraphSnapshot = Awaited<ReturnType<TriageGraph["getState"]>>;

const ValuesSchema = z.object({
  messages: z.array(z.custom<BaseMessage>((value) => BaseMessage.isInstance(value))).default([]),
});

/** Every message of the thread, oldest first. A thread that was never run has none. */
export function messagesOf(snapshot: GraphSnapshot): BaseMessage[] {
  return ValuesSchema.parse(snapshot.values).messages;
}

/** The pending escalation if the run is paused at `human_escalation`, otherwise undefined. */
export function pendingEscalation(snapshot: GraphSnapshot): EscalationPayload | undefined {
  const pending = snapshot.tasks.flatMap((task) => task.interrupts)[0];
  return pending === undefined ? undefined : EscalationPayloadSchema.parse(pending.value);
}
