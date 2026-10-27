import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import {
  modelMessages,
  NURSE_APPROVED_RED_FLAG_TEXT,
  NURSE_REJECTED_TEXT,
  toApiMessages,
} from "../src/graph/messages.js";
import {
  createDemoLlm,
  DEMO_ELEVATED_CONCERN,
  DEMO_ELEVATED_DRAFT,
  DEMO_LOOKUP_FAILED,
  DEMO_TRIAGE_REPLY,
} from "../src/llm/demo.js";
import { LlmUnavailableError } from "../src/llm/port.js";
import { EHR_TOOL } from "../src/mcp/ehr.js";
import { EMERGENCY_NOTICE } from "../src/safety/redFlags.js";
import {
  countingLlm,
  createHarness,
  failingLlm,
  messagesOf,
  pendingPayload,
  RISING_BP_HISTORY,
  scriptedLlm,
  toolCall,
  unansweredToolCallIds,
} from "./support/harness.js";

const lastPatientVisible = async (h: ReturnType<typeof createHarness>) => {
  const messages = toApiMessages(messagesOf(await h.snapshot()), "patient");
  return messages.at(-1);
};

describe("normal triage", () => {
  it("reads the history with the session patient in the run config, then replies", async () => {
    const h = createHarness({ llm: createDemoLlm() });

    await h.say("I have had a mild cough for two days", "t1", "P-1003");

    expect(h.calls).toEqual([
      { name: EHR_TOOL.history, args: { patientId: "SESSION" }, sessionPatientId: "P-1003" },
    ]);
    expect(await lastPatientVisible(h)).toMatchObject({
      role: "assistant",
      content: DEMO_TRIAGE_REPLY,
    });
    expect((await h.snapshot()).next).toEqual([]);
  });

  it("turns a tool failure into an error result and still replies", async () => {
    const h = createHarness({ llm: createDemoLlm(), failHistory: true });

    await h.say("My knee is sore");

    const tool = messagesOf(await h.snapshot()).find((message) => ToolMessage.isInstance(message));
    expect(tool).toMatchObject({ status: "error" });
    expect(await lastPatientVisible(h)).toMatchObject({
      role: "assistant",
      content: DEMO_LOOKUP_FAILED,
    });
  });

  it("starts each turn clean, so one escalation does not stick to the next message", async () => {
    const h = createHarness({ llm: createDemoLlm() });
    await h.say("chest pain");
    await h.resume({ decision: "approve" });

    await h.say("Thanks, I also have a mild cough");

    expect((await h.snapshot()).next).toEqual([]);
    expect(await lastPatientVisible(h)).toMatchObject({ content: DEMO_TRIAGE_REPLY });
  });
});

describe("red flags", () => {
  it("escalates without calling the model or any tool, then resumes on the nurse's decision", async () => {
    const llm = countingLlm(createDemoLlm());
    const h = createHarness({ llm });

    await h.say("I have chest pain and I feel dizzy");

    expect(llm.calls).toBe(0);
    expect(h.calls).toEqual([]);
    const paused = await h.snapshot();
    expect(paused.next).toEqual(["human_escalation"]);
    expect(pendingPayload(paused)).toEqual({ reason: "red_flag", categories: ["chest_pain"] });
    expect(toApiMessages(messagesOf(paused), "patient").map((m) => m.role)).toEqual([
      "patient",
      "system",
    ]);
    expect(toApiMessages(messagesOf(paused), "patient")[1]?.content).toBe(EMERGENCY_NOTICE);

    await h.resume({ decision: "approve" });

    const done = await h.snapshot();
    expect(done.next).toEqual([]);
    expect(await lastPatientVisible(h)).toMatchObject({
      role: "assistant",
      content: NURSE_APPROVED_RED_FLAG_TEXT,
    });
  });

  it("still escalates when the model is down", async () => {
    const h = createHarness({ llm: failingLlm(new LlmUnavailableError("down")) });

    await h.say("I can't breathe");

    expect(pendingPayload(await h.snapshot())).toMatchObject({
      reason: "red_flag",
      categories: ["breathing_difficulty"],
    });
  });

  it("fails a normal message with an LLM error when the model is down", async () => {
    const h = createHarness({ llm: failingLlm(new LlmUnavailableError("down")) });

    await expect(h.say("I have a mild cough")).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("escalates when the optional classifier fails, and never lets it remove a flag", async () => {
    const failing = createHarness({
      llm: createDemoLlm(),
      riskClassifier: async () => {
        throw new Error("classifier offline");
      },
    });
    await failing.say("I have a mild cough");
    expect(pendingPayload(await failing.snapshot())).toEqual({
      reason: "red_flag",
      categories: [],
    });

    const silent = createHarness({ llm: createDemoLlm(), riskClassifier: async () => [] });
    await silent.say("chest pain");
    expect(pendingPayload(await silent.snapshot())).toMatchObject({ categories: ["chest_pain"] });
  });

  it("merges categories the classifier adds", async () => {
    const h = createHarness({ llm: createDemoLlm(), riskClassifier: async () => ["anaphylaxis"] });

    await h.say("chest pain");

    expect(pendingPayload(await h.snapshot())).toMatchObject({
      categories: ["chest_pain", "anaphylaxis"],
    });
  });

  it("delivers a nurse's edited reply and keeps the nurse note away from the patient and the model", async () => {
    const h = createHarness({ llm: createDemoLlm() });
    await h.say("chest pain");

    await h.resume({
      decision: "edit",
      editedReply: "Please come in today.",
      note: "Phoned the patient.",
    });

    const messages = messagesOf(await h.snapshot());
    expect(toApiMessages(messages, "patient").at(-1)).toMatchObject({
      content: "Please come in today.",
    });
    expect(toApiMessages(messages, "patient").map((m) => m.content)).not.toContain(
      "Phoned the patient.",
    );
    expect(toApiMessages(messages, "nurse").map((m) => m.role)).toContain("nurse");
    expect(modelMessages(messages).map((m) => m.text)).not.toContain("Phoned the patient.");
    expect(modelMessages(messages).map((m) => m.text)).not.toContain(EMERGENCY_NOTICE);
  });

  it("delivers the fixed text when a nurse rejects", async () => {
    const h = createHarness({ llm: createDemoLlm() });
    await h.say("chest pain");

    await h.resume({ decision: "reject" });

    expect(await lastPatientVisible(h)).toMatchObject({ content: NURSE_REJECTED_TEXT });
  });
});

describe("assistant-requested review (high-risk output)", () => {
  it("pauses with the concern and draft, closes open tool calls, and delivers the draft on approval", async () => {
    const h = createHarness({ llm: createDemoLlm(), history: RISING_BP_HISTORY });

    await h.say("I feel dizzy and have a headache");

    const paused = await h.snapshot();
    expect(paused.next).toEqual(["human_escalation"]);
    expect(pendingPayload(paused)).toEqual({
      reason: "high_risk_output",
      categories: [],
      concern: DEMO_ELEVATED_CONCERN,
      proposedReply: DEMO_ELEVATED_DRAFT,
    });
    // The draft is withheld until a nurse approves it.
    expect(toApiMessages(messagesOf(paused), "patient").map((m) => m.content)).not.toContain(
      DEMO_ELEVATED_DRAFT,
    );

    await h.resume({ decision: "approve" });

    const done = messagesOf(await h.snapshot());
    expect(unansweredToolCallIds(done)).toEqual([]);
    expect(toApiMessages(done, "patient").at(-1)).toMatchObject({
      role: "assistant",
      content: DEMO_ELEVATED_DRAFT,
    });
  });

  it("answers every tool call in the message that asked for review", async () => {
    const llm = scriptedLlm("triage", [
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_a",
            name: EHR_TOOL.history,
            args: { patientId: "SESSION" },
            type: "tool_call",
          },
          {
            id: "call_b",
            name: "request_nurse_review",
            args: { concern: "unsure" },
            type: "tool_call",
          },
        ],
      }),
    ]);
    const h = createHarness({ llm });

    await h.say("something odd");
    expect(h.calls).toEqual([]);
    await h.resume({ decision: "reject" });

    expect(unansweredToolCallIds(messagesOf(await h.snapshot()))).toEqual([]);
  });
});

describe("tool allowlist", () => {
  it("does not run a booking tool requested by the triage agent", async () => {
    const llm = scriptedLlm("triage", [
      toolCall(EHR_TOOL.book, { patientId: "SESSION", slotId: "S-1001" }),
      new AIMessage("Done."),
    ]);
    const h = createHarness({ llm });

    await h.say("I have a cough");

    expect(h.calls).toEqual([]);
    const refusal = messagesOf(await h.snapshot()).find((message) =>
      ToolMessage.isInstance(message),
    );
    expect(refusal).toMatchObject({
      status: "error",
      content: "This tool is not available for the current request.",
    });
  });

  it("does not run a tool the model invented", async () => {
    const llm = scriptedLlm("triage", [toolCall("drop_all_tables", {}), new AIMessage("Done.")]);
    const h = createHarness({ llm });

    await h.say("I have a cough");

    expect(h.calls).toEqual([]);
    expect(unansweredToolCallIds(messagesOf(await h.snapshot()))).toEqual([]);
  });
});

describe("booking", () => {
  it("offers a slot, waits for the patient, then books it for the session patient", async () => {
    const h = createHarness({ llm: createDemoLlm() });

    await h.say("I'd like to book a cardiology appointment", "t1", "P-1004");
    expect(h.calls.map((c) => c.name)).toEqual([EHR_TOOL.availability]);
    const offer = await lastPatientVisible(h);
    expect(offer?.content).toContain("Shall I book it?");
    expect(offer?.content).toContain("S-1001");

    await h.say("Yes please", "t1", "P-1004");

    expect(h.calls.map((c) => c.name)).toEqual([EHR_TOOL.availability, EHR_TOOL.book]);
    expect(h.calls[1]).toEqual({
      name: EHR_TOOL.book,
      args: { patientId: "SESSION", slotId: "S-1001" },
      sessionPatientId: "P-1004",
    });
    expect((await lastPatientVisible(h))?.content).toContain("A-0001");
  });

  it("refuses to book in the same turn the slot was proposed", async () => {
    const llm = scriptedLlm("booking", [
      toolCall("propose_booking", { slotId: "S-1001" }, "call_1"),
      toolCall(EHR_TOOL.book, { patientId: "SESSION", slotId: "S-1001" }, "call_2"),
      new AIMessage("Booked!"),
    ]);
    const h = createHarness({ llm });

    await h.say("book me something");

    expect(h.calls).toEqual([]);
    const results = messagesOf(await h.snapshot()).filter((message) =>
      ToolMessage.isInstance(message),
    );
    expect(results.map((r) => r.status)).toEqual(["success", "error"]);
    expect(results[1]?.text).toContain("Booking refused");
  });

  it("refuses to book a different slot than the one proposed, even after the patient replied", async () => {
    const llm = scriptedLlm("booking", [
      toolCall("propose_booking", { slotId: "S-1001" }, "call_1"),
      new AIMessage("Shall I book S-1001?"),
      toolCall(EHR_TOOL.book, { patientId: "SESSION", slotId: "S-1002" }, "call_2"),
      new AIMessage("Sorry."),
    ]);
    const h = createHarness({ llm });

    await h.say("book me something");
    await h.say("yes");

    expect(h.calls).toEqual([]);
  });

  it("allows the booking once the patient has replied to the proposal", async () => {
    const llm = scriptedLlm("booking", [
      toolCall("propose_booking", { slotId: "S-1001" }, "call_1"),
      new AIMessage("Shall I book S-1001?"),
      toolCall(EHR_TOOL.book, { patientId: "SESSION", slotId: "S-1001" }, "call_2"),
      new AIMessage("Booked."),
    ]);
    const h = createHarness({ llm });

    await h.say("book me something");
    await h.say("yes");

    expect(h.calls.map((c) => c.name)).toEqual([EHR_TOOL.book]);
    expect(llm.remaining).toBe(0);
  });
});
