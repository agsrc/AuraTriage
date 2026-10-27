import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { END, START, StateGraph } from "@langchain/langgraph";
import {
  AFTER_AGENT,
  AFTER_GATE,
  AFTER_INTAKE,
  AFTER_TOOLS,
  NODES,
  routeAfterAgent,
  routeAfterGate,
  routeAfterIntake,
  routeAfterTools,
} from "./edges.js";
import { createNodes, type GraphDeps } from "./nodes.js";
import { TriageAnnotation } from "./state.js";

/**
 * safety_gate -> human_escalation | patient_intake
 * patient_intake -> triage_agent | booking_agent
 * agents <-> tool_execution, or -> human_escalation, or -> END
 * human_escalation -> respond -> END
 */
export function buildTriageGraph(deps: GraphDeps, checkpointer: BaseCheckpointSaver) {
  const nodes = createNodes(deps);
  return new StateGraph(TriageAnnotation)
    .addNode(NODES.safetyGate, nodes.safetyGate)
    .addNode(NODES.patientIntake, nodes.patientIntake)
    .addNode(NODES.triageAgent, nodes.triageAgent)
    .addNode(NODES.bookingAgent, nodes.bookingAgent)
    .addNode(NODES.toolExecution, nodes.toolExecution)
    .addNode(NODES.humanEscalation, nodes.humanEscalation)
    .addNode(NODES.respond, nodes.respond)
    .addEdge(START, NODES.safetyGate)
    .addConditionalEdges(NODES.safetyGate, routeAfterGate, [...AFTER_GATE])
    .addConditionalEdges(NODES.patientIntake, routeAfterIntake, [...AFTER_INTAKE])
    .addConditionalEdges(NODES.triageAgent, routeAfterAgent, [...AFTER_AGENT])
    .addConditionalEdges(NODES.bookingAgent, routeAfterAgent, [...AFTER_AGENT])
    .addConditionalEdges(NODES.toolExecution, routeAfterTools, [...AFTER_TOOLS])
    .addEdge(NODES.humanEscalation, NODES.respond)
    .addEdge(NODES.respond, END)
    .compile({ checkpointer });
}

export type TriageGraph = ReturnType<typeof buildTriageGraph>;
