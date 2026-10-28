import path from "node:path";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { CASES } from "../eval/cases.js";
import { noOtherPatientId, redFlagGate } from "../eval/checks.js";
import { evaluate } from "../eval/evaluate.js";
import type { CaseRecord, TurnRecord } from "../eval/model.js";
import { type CaseResult, formatReport, summarize } from "../eval/summary.js";
import { loadConfig } from "../src/config.js";
import { type LlmPort, LlmUnavailableError } from "../src/llm/port.js";
import { EHR_TOOL } from "../src/mcp/ehr.js";
import { toolCall } from "./support/harness.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const config = loadConfig({ EHR_MCP_SERVER: "mock", LLM_PROVIDER: "fake" }, repoRoot);

const failed = (results: readonly CaseResult[], caseId: string): string[] =>
  results
    .filter((result) => result.caseId === caseId)
    .flatMap((result) => result.outcomes.filter((o) => !o.pass).map((o) => o.checkId));

describe("eval cases", () => {
  it("have unique ids, at least one check each, and only synthetic patient IDs", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CASES) {
      expect(c.checks.length, c.id).toBeGreaterThan(0);
      expect(c.patientId, c.id).toMatch(/^P-100[1-5]$/);
      expect(c.turns.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe("the offline model", () => {
  it("passes every case, which proves the harness and the cases agree with the system", async () => {
    const outcome = await evaluate({ config, caseIds: [], runs: 1 });

    const problems = outcome.results
      .filter((result) => !result.passed)
      .map((result) => `${result.caseId}: ${failedChecks(result)}`);
    expect(problems).toEqual([]);
    expect(outcome.summary.criticalFailures).toEqual([]);
    expect(outcome.summary.turnErrors).toBe(0);
  }, 60_000);

  it("repeats cases when asked, and reports no flakiness for a deterministic model", async () => {
    const outcome = await evaluate({ config, caseIds: ["triage-minor-cough"], runs: 3 });

    expect(outcome.summary.caseRuns).toBe(3);
    expect(outcome.summary.runs).toBe(3);
    expect(outcome.summary.flaky).toEqual([]);
  }, 60_000);

  it("rejects a case id that does not exist", async () => {
    await expect(evaluate({ config, caseIds: ["nope"], runs: 1 })).rejects.toThrow(/nope/);
  });
});

function failedChecks(result: CaseResult): string {
  return result.outcomes
    .filter((o) => !o.pass)
    .map((o) => `${o.checkId} (${o.detail})`)
    .join(", ");
}

/** A booking agent that tries to book a made-up slot straight away, then gives up. */
function eagerBooker(): LlmPort {
  return {
    complete: async () => new AIMessage("booking"),
    completeWithTools: async (messages) =>
      ToolMessage.isInstance(messages.at(-1))
        ? new AIMessage("Done.")
        : toolCall(EHR_TOOL.book, { patientId: "SESSION", slotId: "S-9999" }),
  };
}

/** Always reassures, never asks for a nurse, and repeats whatever record it was shown. */
function leakyReassurer(): LlmPort {
  return {
    complete: async () => new AIMessage("triage"),
    completeWithTools: async () =>
      new AIMessage("Their medicines are lisinopril and metformin, so you are fine."),
  };
}

function modelThatIsDown(): LlmPort {
  const down = () => Promise.reject(new LlmUnavailableError("down"));
  return { complete: down, completeWithTools: down };
}

describe("a model that misbehaves", () => {
  it("is caught trying to book before the patient confirmed, while the guard still holds", async () => {
    const { results } = await evaluate({
      config,
      caseIds: ["book-pressure-to-skip-confirmation"],
      runs: 1,
      llm: eagerBooker(),
    });

    const problems = failed(results, "book-pressure-to-skip-confirmation");
    expect(problems).toContain("no_premature_booking");
    expect(problems).toContain("proposed_without_booking");
    // The graph refused the booking, so the critical "nothing was booked" check still passes.
    expect(problems).not.toContain("never_ran:ehr_book_appointment");
  }, 60_000);

  it("is caught leaking another patient's record, as a critical failure", async () => {
    const { results, summary } = await evaluate({
      config,
      caseIds: ["inject-read-other-patient"],
      runs: 1,
      llm: leakyReassurer(),
    });

    expect(failed(results, "inject-read-other-patient")).toContain("no_leak");
    expect(summary.criticalFailures.map((f) => f.checkId)).toContain("no_leak");
  }, 60_000);

  it("is caught reassuring a patient whose history called for a nurse", async () => {
    const { results } = await evaluate({
      config,
      caseIds: ["escalate-rising-bp-with-symptoms"],
      runs: 1,
      llm: leakyReassurer(),
    });

    expect(failed(results, "escalate-rising-bp-with-symptoms")).toContain("escalated_by_model");
  }, 60_000);

  it("cannot break the red-flag gate by being down: emergencies still escalate without the model", async () => {
    const { results, summary } = await evaluate({
      config,
      caseIds: ["gate-chest-pain", "gate-self-harm", "triage-minor-cough"],
      runs: 1,
      llm: modelThatIsDown(),
    });

    expect(failed(results, "gate-chest-pain")).toEqual([]);
    expect(failed(results, "gate-self-harm")).toEqual([]);
    expect(failed(results, "triage-minor-cough")).toContain("replied");
    expect(summary.turnErrors).toBe(1);
    expect(summary.criticalFailures).toEqual([]);
  }, 60_000);
});

const turn = (overrides: Partial<TurnRecord> = {}): TurnRecord => ({
  patientText: "x",
  toolCalls: [],
  emergencyNotice: false,
  modelCalls: 0,
  ms: 10,
  ...overrides,
});

describe("checks and reporting", () => {
  it("flags a tool call that carries a real patient ID", () => {
    const record: CaseRecord = {
      caseId: "x",
      turns: [
        turn({
          toolCalls: [{ name: EHR_TOOL.history, args: { patientId: "P-1001" }, outcome: "ok" }],
        }),
      ],
    };

    expect(noOtherPatientId().evaluate(record).pass).toBe(false);
  });

  it("requires the red-flag gate to skip the model and show the notice", () => {
    const paused = { reason: "red_flag" as const, categories: [] };

    expect(
      redFlagGate().evaluate({
        caseId: "x",
        turns: [turn({ paused, emergencyNotice: true, modelCalls: 0 })],
      }).pass,
    ).toBe(true);
    expect(
      redFlagGate().evaluate({
        caseId: "x",
        turns: [turn({ paused, emergencyNotice: true, modelCalls: 1 })],
      }).pass,
    ).toBe(false);
    expect(
      redFlagGate().evaluate({ caseId: "x", turns: [turn({ paused, emergencyNotice: false })] })
        .pass,
    ).toBe(false);
  });

  it("marks a case flaky when it passes in some runs and fails in others, and prints the failures", () => {
    const result = (run: number, pass: boolean): CaseResult => ({
      caseId: "c1",
      category: "booking",
      run,
      record: { caseId: "c1", turns: [turn({ ms: run * 100 })] },
      outcomes: [
        { checkId: "replied", critical: false, pass, detail: pass ? "ok" : "empty reply" },
      ],
      passed: pass,
    });
    const results = [result(1, true), result(2, false), result(3, true)];

    const summary = summarize(results);

    expect(summary.flaky).toEqual(["c1"]);
    expect(summary.passRate).toBeCloseTo(2 / 3);
    expect(summary.latencyMs).toEqual({ p50: 200, p95: 300 });
    const report = formatReport(results, summary, { provider: "p", model: "m", ehr: "e" });
    expect(report).toContain("FAIL  c1 #2");
    expect(report).toContain("replied: empty reply");
    expect(report).toContain("Flaky");
  });
});
