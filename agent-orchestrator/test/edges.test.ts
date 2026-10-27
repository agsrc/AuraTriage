import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { END, StateGraph } from "@langchain/langgraph";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AfterAgent,
  type AfterGate,
  type AfterIntake,
  type AfterTools,
  type NodeName,
  routeAfterAgent,
  routeAfterGate,
  routeAfterIntake,
  routeAfterTools,
} from "../src/graph/edges.js";
import { TriageAnnotation, type TriageState } from "../src/graph/state.js";

function state(overrides: Partial<TriageState> = {}): TriageState {
  return {
    messages: [new HumanMessage("hi")],
    intent: null,
    escalation: null,
    pendingBooking: null,
    ...overrides,
  };
}

const callMessage = (...names: string[]) =>
  new AIMessage({
    content: "",
    tool_calls: names.map((name, index) => ({
      id: `c${index}`,
      name,
      args: {},
      type: "tool_call" as const,
    })),
  });

describe("router behaviour", () => {
  it("sends a red flag straight to a nurse", () => {
    expect(routeAfterGate(state())).toBe("patient_intake");
    expect(
      routeAfterGate(state({ escalation: { reason: "red_flag", categories: ["chest_pain"] } })),
    ).toBe("human_escalation");
  });

  it("routes by intent, defaulting to the read-only triage agent", () => {
    expect(routeAfterIntake(state({ intent: "booking" }))).toBe("booking_agent");
    expect(routeAfterIntake(state({ intent: "triage" }))).toBe("triage_agent");
    expect(routeAfterIntake(state({ intent: null }))).toBe("triage_agent");
    expect(routeAfterTools(state({ intent: "booking" }))).toBe("booking_agent");
    expect(routeAfterTools(state({ intent: "triage" }))).toBe("triage_agent");
  });

  it("ends when the agent made no tool calls, and runs tools when it did", () => {
    expect(
      routeAfterAgent(state({ messages: [new HumanMessage("hi"), new AIMessage("hello")] })),
    ).toBe(END);
    expect(routeAfterAgent(state({ messages: [callMessage("ehr_get_patient_history")] }))).toBe(
      "tool_execution",
    );
  });

  it("lets a nurse-review request win over other tool calls", () => {
    expect(
      routeAfterAgent(
        state({ messages: [callMessage("ehr_get_patient_history", "request_nurse_review")] }),
      ),
    ).toBe("human_escalation");
  });
});

describe("edge typing", () => {
  it("limits each router to the nodes it may return", () => {
    expectTypeOf(routeAfterGate).returns.toEqualTypeOf<AfterGate>();
    expectTypeOf<AfterGate>().toEqualTypeOf<"human_escalation" | "patient_intake">();
    expectTypeOf<AfterIntake>().toEqualTypeOf<"triage_agent" | "booking_agent">();
    expectTypeOf<AfterAgent>().toEqualTypeOf<"tool_execution" | "human_escalation" | typeof END>();
    expectTypeOf<AfterTools>().toEqualTypeOf<"triage_agent" | "booking_agent">();
    expectTypeOf(routeAfterAgent).returns.toEqualTypeOf<AfterAgent>();
  });

  it("knows exactly seven nodes", () => {
    expectTypeOf<NodeName>().toEqualTypeOf<
      | "safety_gate"
      | "patient_intake"
      | "triage_agent"
      | "booking_agent"
      | "tool_execution"
      | "human_escalation"
      | "respond"
    >();
  });

  it("rejects an edge to a node that does not exist, at compile time", () => {
    const graph = new StateGraph(TriageAnnotation).addNode("only_node", () => ({}));

    // If LangGraph's types ever stop catching this, `tsc` fails on the unused directive below.
    // @ts-expect-error "missing_node" was never registered
    graph.addEdge("only_node", "missing_node");

    expect(graph).toBeDefined();
  });
});
