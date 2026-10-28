import { AIMessage } from "@langchain/core/messages";
import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createDemoLlm } from "../src/llm/demo.js";
import { EHR_TOOL } from "../src/mcp/ehr.js";
import { withLlmTracing } from "../src/telemetry/spans.js";
import { initTracing } from "../src/telemetry/tracing.js";
import { createHarness, scriptedLlm, toolCall } from "./support/harness.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => provider.register());
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});
beforeEach(() => exporter.reset());

const byName = (name: string): ReadableSpan[] =>
  exporter.getFinishedSpans().filter((span) => span.name === name);

const only = (name: string): ReadableSpan => {
  const spans = byName(name);
  expect(spans, `spans named ${name}`).toHaveLength(1);
  return spans[0] as ReadableSpan;
};

/** Everything an exporter would send, as one string, to search for things that must not be there. */
const everythingExported = (): string =>
  JSON.stringify(
    exporter.getFinishedSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
      status: span.status,
      events: span.events,
      resource: span.resource.attributes,
    })),
  );

// Synthetic names that stand in for patient data. None of them may reach a trace.
const CANARIES = ["Quillfeather", "Oakhollow", "Thornbury", "Marlowe-Finch", "Ravenscroft"];

describe("graph spans", () => {
  it("records a span for each node, the model call and the tool call, linked as a tree", async () => {
    const h = createHarness({ llm: withLlmTracing(createDemoLlm(), "demo") });

    await h.say("I have had a mild cough for two days", "t-trace-1", "P-1003");

    for (const name of [
      "node.safety_gate",
      "node.patient_intake",
      "node.triage_agent",
      "node.tool_execution",
      "llm.complete",
      "llm.complete_with_tools",
      "tool.invoke",
    ]) {
      expect(byName(name).length, name).toBeGreaterThan(0);
    }
    // The tool span is a child of the tool_execution node span, so the context carries through.
    expect(only("tool.invoke").parentSpanContext?.spanId).toBe(
      only("node.tool_execution").spanContext().spanId,
    );
    expect(only("node.safety_gate").attributes).toMatchObject({
      "triage.node": "safety_gate",
      "triage.thread_id": "t-trace-1",
      "triage.patient_id": "P-1003",
      "triage.red_flag": false,
    });
    expect(only("tool.invoke").attributes).toMatchObject({
      "openinference.span.kind": "TOOL",
      "tool.name": "ehr_get_patient_history",
    });
    expect(byName("llm.complete")[0]?.attributes).toMatchObject({
      "openinference.span.kind": "LLM",
      "llm.model_name": "demo",
      "llm.tool_call_count": 0,
    });
  });

  it("marks a red flag and a pause without calling the pause an error", async () => {
    const h = createHarness({ llm: withLlmTracing(createDemoLlm(), "demo") });

    await h.say("I have chest pain", "t-trace-2", "P-1001");

    expect(only("node.safety_gate").attributes).toMatchObject({
      "triage.red_flag": true,
      "triage.red_flag_categories": ["chest_pain"],
    });
    const paused = only("node.human_escalation");
    expect(paused.attributes["triage.interrupted"]).toBe(true);
    expect(paused.status.code).not.toBe(2); // 2 is SpanStatusCode.ERROR
    expect(byName("llm.complete")).toHaveLength(0);

    exporter.reset();
    await h.resume({ decision: "reject" }, "t-trace-2", "P-1001");

    expect(byName("node.human_escalation")[0]?.attributes["triage.decision"]).toBe("reject");
  });

  it("marks a failing tool as an error with the error class, not its message", async () => {
    const h = createHarness({ llm: createDemoLlm(), failHistory: true });

    await h.say("My knee is sore");

    const failed = only("tool.invoke");
    expect(failed.status.code).toBe(2);
    expect(failed.attributes["error.type"]).toEqual(expect.any(String));
    expect(failed.events).toHaveLength(0);
  });

  it("counts the tool calls a model asked for without recording their arguments", async () => {
    const llm = withLlmTracing(
      scriptedLlm("booking", [
        toolCall(EHR_TOOL.availability, { specialty: "secretspecialty" }),
        new AIMessage("Done."),
      ]),
      "scripted",
    );
    const h = createHarness({ llm });

    await h.say("I want a booking");

    const counts = byName("llm.complete_with_tools").map(
      (s) => s.attributes["llm.tool_call_count"],
    );
    expect(counts).toContain(1);
    expect(everythingExported()).not.toContain("secretspecialty");
  });
});

describe("what a trace may contain", () => {
  it("would notice a leak, so the check below can fail", () => {
    const span = trace.getTracer("probe").startSpan("probe");
    span.setAttribute("leak", CANARIES[0] ?? "");
    span.end();

    expect(everythingExported()).toContain("Quillfeather");
  });

  it("never carries patient text, names, nurse notes or edited replies", async () => {
    const llm = withLlmTracing(createDemoLlm(), "demo");

    const normal = createHarness({ llm });
    await normal.say(
      `I am ${CANARIES[0]} ${CANARIES[1]}, born 1980-02-03, and I have a mild cough`,
      "t-trace-3",
      "P-1003",
    );

    const urgent = createHarness({ llm });
    await urgent.say(
      `${CANARIES[2]} here, I have chest pain near ${CANARIES[3]} Road`,
      "t-trace-4",
    );
    await urgent.resume(
      {
        decision: "edit",
        editedReply: `Please call us, ${CANARIES[4]}`,
        note: `Internal: ${CANARIES[4]} is a repeat caller`,
      },
      "t-trace-4",
      "P-1001",
    );

    const exported = everythingExported();
    expect(exported.length).toBeGreaterThan(200);
    for (const secret of [
      ...CANARIES,
      "1980-02-03",
      "mild cough",
      "chest pain near",
      "repeat caller",
    ]) {
      expect(exported, secret).not.toContain(secret);
    }
  });
});

describe("initTracing", () => {
  it("does nothing when tracing is off", async () => {
    const tracing = initTracing({
      enabled: false,
      endpoint: "http://localhost:6006/v1/traces",
      serviceName: "x",
    });

    expect(tracing.enabled).toBe(false);
    await expect(tracing.shutdown()).resolves.toBeUndefined();
  });

  it("is off by default and reads its settings from the environment", () => {
    const root = "/repo";
    expect(loadConfig({}, root).tracing).toEqual({
      enabled: false,
      endpoint: "http://localhost:6006/v1/traces",
      serviceName: "auratriage",
    });
    expect(
      loadConfig(
        {
          OTEL_ENABLED: "true",
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
          OTEL_SERVICE_NAME: "demo",
        },
        root,
      ).tracing,
    ).toEqual({ enabled: true, endpoint: "http://127.0.0.1:4318/v1/traces", serviceName: "demo" });
    expect(() => loadConfig({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "nope" }, root)).toThrow(
      /OTEL_EXPORTER_OTLP_TRACES_ENDPOINT/,
    );
  });
});
