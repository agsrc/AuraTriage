import { END } from "@langchain/langgraph";
import { LOCAL_TOOL } from "./localTools.js";
import { lastAiMessage } from "./messages.js";
import type { TriageState } from "./state.js";

export const NODES = {
  safetyGate: "safety_gate",
  patientIntake: "patient_intake",
  triageAgent: "triage_agent",
  bookingAgent: "booking_agent",
  toolExecution: "tool_execution",
  humanEscalation: "human_escalation",
  respond: "respond",
} as const;
export type NodeName = (typeof NODES)[keyof typeof NODES];

// Each router names exactly the nodes it can return. `build.ts` hands the same lists to LangGraph,
// so a router that returns anything else, or a node that does not exist, fails `tsc`.
export type AfterGate = typeof NODES.humanEscalation | typeof NODES.patientIntake;
export type AfterIntake = typeof NODES.triageAgent | typeof NODES.bookingAgent;
export type AfterAgent = typeof NODES.toolExecution | typeof NODES.humanEscalation | typeof END;
export type AfterTools = typeof NODES.triageAgent | typeof NODES.bookingAgent;

export const AFTER_GATE = [
  NODES.humanEscalation,
  NODES.patientIntake,
] as const satisfies readonly AfterGate[];
export const AFTER_INTAKE = [
  NODES.triageAgent,
  NODES.bookingAgent,
] as const satisfies readonly AfterIntake[];
export const AFTER_AGENT = [
  NODES.toolExecution,
  NODES.humanEscalation,
  END,
] as const satisfies readonly AfterAgent[];
export const AFTER_TOOLS = [
  NODES.triageAgent,
  NODES.bookingAgent,
] as const satisfies readonly AfterTools[];

/** A red flag skips every model call and goes straight to a nurse. */
export function routeAfterGate(state: TriageState): AfterGate {
  return state.escalation !== null ? NODES.humanEscalation : NODES.patientIntake;
}

export function routeAfterIntake(state: TriageState): AfterIntake {
  return state.intent === "booking" ? NODES.bookingAgent : NODES.triageAgent;
}

/** A nurse-review request wins over any other tool calls in the same message. */
export function routeAfterAgent(state: TriageState): AfterAgent {
  const calls = lastAiMessage(state.messages)?.tool_calls ?? [];
  if (calls.some((call) => call.name === LOCAL_TOOL.requestNurseReview)) {
    return NODES.humanEscalation;
  }
  return calls.length > 0 ? NODES.toolExecution : END;
}

export function routeAfterTools(state: TriageState): AfterTools {
  return state.intent === "booking" ? NODES.bookingAgent : NODES.triageAgent;
}
