import { MemorySaver } from "@langchain/langgraph";
import type { Config } from "../src/config.js";
import { buildTriageGraph } from "../src/graph/build.js";
import { createLlm, llmLabel } from "../src/llm/factory.js";
import type { LlmPort } from "../src/llm/port.js";
import { connectEhr } from "../src/mcp/ehr.js";
import { withLlmTracing } from "../src/telemetry/spans.js";
import { selectCases } from "./cases.js";
import { countingLlm, runCase } from "./runner.js";
import { type CaseResult, type ReportMeta, type Summary, scoreCase, summarize } from "./summary.js";

export interface EvalOptions {
  config: Config;
  /** Empty means every case. */
  caseIds: readonly string[];
  /** Models are not deterministic, so each case can be repeated to see how reliable it is. */
  runs: number;
  /** Replaces the model from the config. Used by tests to play a model that misbehaves. */
  llm?: LlmPort;
}

export interface EvalOutcome {
  results: CaseResult[];
  summary: Summary;
  meta: ReportMeta;
}

function ehrLabel(spec: Config["ehrServer"]): string {
  return spec.args.some((arg) => arg.endsWith("mock-ehr-server.mjs"))
    ? "mock stand-in"
    : "java server";
}

/**
 * Runs the cases through the real graph, the real MCP adapter and the configured model, with the
 * real session-binding hook, but without HTTP. Each case is its own conversation.
 */
export async function evaluate(options: EvalOptions): Promise<EvalOutcome> {
  const cases = selectCases(options.caseIds);
  const ehr = await connectEhr(options.config.ehrServer);
  try {
    const label = llmLabel(options.config.llm);
    const llm = countingLlm(withLlmTracing(options.llm ?? createLlm(options.config.llm), label));
    const graph = buildTriageGraph(
      { llm, tools: ehr.tools, now: () => new Date() },
      new MemorySaver(),
    );

    const results: CaseResult[] = [];
    for (let run = 1; run <= options.runs; run++) {
      for (const evalCase of cases) {
        results.push(scoreCase(evalCase, run, await runCase(graph, llm, evalCase, run)));
      }
    }
    return {
      results,
      summary: summarize(results),
      meta: {
        provider: options.config.llm.provider,
        model: label,
        ehr: ehrLabel(options.config.ehrServer),
      },
    };
  } finally {
    await ehr.close().catch(() => undefined);
  }
}
