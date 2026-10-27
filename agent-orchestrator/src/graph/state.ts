import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { z } from "zod";
import {
  type EscalationReason,
  EscalationReasonSchema,
  type NurseResolution,
  type RedFlagCategory,
  RedFlagCategorySchema,
} from "../contracts.js";

export type Intent = "triage" | "booking";

export interface EscalationState {
  reason: EscalationReason;
  categories: RedFlagCategory[];
  /** Why the assistant asked for review (high_risk_output only). */
  concern?: string;
  /** What the assistant would have sent, delivered if the nurse approves (high_risk_output only). */
  proposedReply?: string;
  /** Set once a nurse has decided. */
  resolution?: NurseResolution;
}

export interface PendingBooking {
  slotId: string;
  /** How many patient messages existed when the slot was proposed. Booking needs a later one. */
  humanTurn: number;
}

/** What `interrupt()` hands to whoever resumes the graph. Free text from the patient is not included. */
export const EscalationPayloadSchema = z.object({
  reason: EscalationReasonSchema,
  categories: z.array(RedFlagCategorySchema),
  concern: z.string().optional(),
  proposedReply: z.string().optional(),
});
export type EscalationPayload = z.infer<typeof EscalationPayloadSchema>;

const replace = <T>(_current: T, next: T): T => next;

export const TriageAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  intent: Annotation<Intent | null>({ reducer: replace, default: () => null }),
  escalation: Annotation<EscalationState | null>({ reducer: replace, default: () => null }),
  pendingBooking: Annotation<PendingBooking | null>({ reducer: replace, default: () => null }),
});

export type TriageState = typeof TriageAnnotation.State;
export type TriageUpdate = typeof TriageAnnotation.Update;
