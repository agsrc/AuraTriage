import { randomUUID } from "node:crypto";
import { AIMessage, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { z } from "zod";
import { LOCAL_TOOL } from "../graph/localTools.js";
import { latestHumanText } from "../graph/messages.js";
import { ROLE_MARKER } from "../graph/prompts.js";
import { EHR_TOOL, SESSION_PLACEHOLDER } from "../mcp/ehr.js";
import {
  AvailabilityResultSchema,
  BookingResultSchema,
  PatientHistorySummarySchema,
} from "../mcp/schemas.js";
import type { LlmPort } from "./port.js";

/**
 * Deterministic stand-in for a language model. It follows fixed rules, needs no key and costs
 * nothing, so tests and demos behave the same every time. It is a scripted policy, not an
 * attempt at medical judgement.
 */

const BOOKING_INTENT = /\b(book|booking|appointment|schedule|reschedule|slot|cancel)\b/i;
const AFFIRMATIVE = /\b(yes|yep|yeah|confirm|confirmed|please do|go ahead|book it|sounds good)\b/i;

export const DEMO_TRIAGE_REPLY =
  "Thanks for the details. I have looked at your recent history and, from what you describe, this does not " +
  "sound urgent. Rest, keep an eye on your symptoms, and book a visit if they last more than a few days or " +
  "get worse. If anything changes quickly, call us or your local emergency number.";
export const DEMO_ELEVATED_CONCERN =
  "Rising systolic blood pressure trend in the history alongside new symptoms.";
export const DEMO_ELEVATED_DRAFT =
  "Your recent blood pressure readings have been climbing, so please arrange a check-up this week and keep a " +
  "log of your readings. If your symptoms get worse, call us or your local emergency number.";
export const DEMO_LOOKUP_FAILED =
  "I could not look up your records just now. If this is urgent, please contact the clinic directly or call " +
  "your local emergency number.";

function callTool(name: string, args: Record<string, unknown>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: `call_${randomUUID()}`, name, args, type: "tool_call" }],
  });
}

function turnSinceLastHuman(messages: readonly BaseMessage[]): BaseMessage[] {
  const lastHuman = messages.findLastIndex((message) => message.type === "human");
  return messages.slice(lastHuman + 1);
}

interface ToolOutcome {
  text: string;
  failed: boolean;
}

function outcomeOf(turn: readonly BaseMessage[], toolName: string): ToolOutcome | undefined {
  const message = turn.findLast(
    (candidate) => ToolMessage.isInstance(candidate) && candidate.name === toolName,
  );
  return message && ToolMessage.isInstance(message)
    ? { text: message.text, failed: message.status === "error" }
    : undefined;
}

function parseOutcome<S extends z.ZodType>(
  outcome: ToolOutcome | undefined,
  schema: S,
): z.infer<S> | undefined {
  if (!outcome || outcome.failed) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(outcome.text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function proposedSlotBefore(messages: readonly BaseMessage[]): string | undefined {
  for (const message of [...messages].reverse()) {
    if (!AIMessage.isInstance(message)) continue;
    for (const call of message.tool_calls ?? []) {
      const slotId: unknown = call.args.slotId;
      if (call.name === LOCAL_TOOL.proposeBooking && typeof slotId === "string") return slotId;
    }
  }
  return undefined;
}

function guessSpecialty(text: string): string {
  if (/cardio|heart/i.test(text)) return "cardiology";
  if (/derma|skin|rash/i.test(text)) return "dermatology";
  if (/neuro|migraine|headache/i.test(text)) return "neurology";
  return "primary_care";
}

function triageStep(messages: readonly BaseMessage[]): AIMessage {
  const turn = turnSinceLastHuman(messages);
  const outcome = outcomeOf(turn, EHR_TOOL.history);
  if (outcome === undefined) {
    return callTool(EHR_TOOL.history, { patientId: SESSION_PLACEHOLDER });
  }
  const history = parseOutcome(outcome, PatientHistorySummarySchema);
  if (history === undefined) {
    return new AIMessage(DEMO_LOOKUP_FAILED);
  }
  const risingPressure = history.vitalsTrends.some(
    (trend) => trend.metric === "systolic_bp" && trend.direction === "rising",
  );
  if (risingPressure) {
    return callTool(LOCAL_TOOL.requestNurseReview, {
      concern: DEMO_ELEVATED_CONCERN,
      draftReply: DEMO_ELEVATED_DRAFT,
    });
  }
  return new AIMessage(DEMO_TRIAGE_REPLY);
}

function bookingStep(messages: readonly BaseMessage[]): AIMessage {
  const turn = turnSinceLastHuman(messages);
  const humanText = latestHumanText(messages);

  const booked = outcomeOf(turn, EHR_TOOL.book);
  if (booked !== undefined) {
    const result = parseOutcome(booked, BookingResultSchema);
    if (result?.status === "booked") {
      return new AIMessage(
        `Your appointment is booked. Your reference is ${result.appointmentId ?? "on file"}.`,
      );
    }
    return new AIMessage(
      "That slot is no longer available. Would you like me to look for another time?",
    );
  }

  const availability = parseOutcome(
    outcomeOf(turn, EHR_TOOL.availability),
    AvailabilityResultSchema,
  );
  const proposal = outcomeOf(turn, LOCAL_TOOL.proposeBooking);
  if (availability !== undefined) {
    const first = availability.slots[0];
    if (first === undefined) {
      return new AIMessage(
        "I could not find any openings for that type of visit right now. Please try again later.",
      );
    }
    if (proposal === undefined) {
      return callTool(LOCAL_TOOL.proposeBooking, { slotId: first.slotId });
    }
    return new AIMessage(
      `The earliest opening is with ${first.providerName} at ${first.start} (slot ${first.slotId}). ` +
        "Shall I book it? Reply yes to confirm.",
    );
  }

  const earlier = proposedSlotBefore(messages);
  if (earlier !== undefined && AFFIRMATIVE.test(humanText)) {
    return callTool(EHR_TOOL.book, { patientId: SESSION_PLACEHOLDER, slotId: earlier });
  }
  return callTool(EHR_TOOL.availability, { specialty: guessSpecialty(humanText) });
}

export function createDemoLlm(): LlmPort {
  return {
    async complete(messages) {
      const text = latestHumanText(messages);
      // A bare "yes" belongs to booking when a slot was offered earlier in the conversation.
      const answeringAnOffer = AFFIRMATIVE.test(text) && proposedSlotBefore(messages) !== undefined;
      return new AIMessage(BOOKING_INTENT.test(text) || answeringAnOffer ? "booking" : "triage");
    },
    async completeWithTools(messages) {
      const system = messages.find((message) => message.type === "system")?.text ?? "";
      return system.startsWith(ROLE_MARKER.booking) ? bookingStep(messages) : triageStep(messages);
    },
  };
}
