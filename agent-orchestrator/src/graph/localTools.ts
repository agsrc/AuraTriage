import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SLOT_ID_PATTERN } from "../contracts.js";

/**
 * Tools the orchestrator handles itself. The model sees them next to the EHR tools, but the graph
 * intercepts the calls: they change graph state rather than reaching the EHR.
 */
export const LOCAL_TOOL = {
  requestNurseReview: "request_nurse_review",
  proposeBooking: "propose_booking",
} as const;

export const ReviewArgsSchema = z.object({
  concern: z.string().min(1).max(500),
  draftReply: z.string().max(2000).optional(),
});

export const ProposeBookingArgsSchema = z.object({
  slotId: z.string().regex(SLOT_ID_PATTERN),
});

const HANDLED_BY_GRAPH = "Handled by the orchestrator.";

export const requestNurseReviewTool = tool(async () => HANDLED_BY_GRAPH, {
  name: LOCAL_TOOL.requestNurseReview,
  description:
    "Ask a nurse to review this conversation before anything is sent to the patient. Use it whenever the " +
    "situation could be urgent or you are unsure. Give a short concern and the reply you would otherwise send.",
  schema: ReviewArgsSchema,
});

export const proposeBookingTool = tool(async () => HANDLED_BY_GRAPH, {
  name: LOCAL_TOOL.proposeBooking,
  description:
    "Record the one slot you are about to offer the patient. After calling it, ask the patient to confirm and stop. " +
    "You may only book that slot in a later turn, after the patient has replied.",
  schema: ProposeBookingArgsSchema,
});
