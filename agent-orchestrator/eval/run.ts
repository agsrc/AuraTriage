import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { ConfigError, disableTracing, loadConfig } from "../src/config.js";
import { initTracing } from "../src/telemetry/tracing.js";
import { EvalUsageError } from "./cases.js";
import { evaluate } from "./evaluate.js";
import { formatReport } from "./summary.js";

// eval/ sits directly under agent-orchestrator/, which sits under the repo root.
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const USAGE = `Usage: npm run eval -w agent-orchestrator -- [options]

  --runs <n>        repeat every case n times (default 1), to see how reliable the model is
  --case <id>       run only this case; repeat the flag for several
  --min-pass <0-1>  fail the run below this pass rate (default 1 for the offline model, else report only)
  --no-save         do not write the JSON report to eval/results/

The model comes from LLM_PROVIDER (fake, ollama, anthropic) and the EHR from EHR_MCP_SERVER, read
from the environment and the repo's .env. Critical checks always fail the run when they fail.`;

function loadDotEnv(): void {
  try {
    process.loadEnvFile(path.join(repoRoot, ".env"));
  } catch {
    // No .env file: use the real environment only.
  }
}

function fraction(name: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new EvalUsageError(`${name} must be a number from 0 to 1`);
  }
  return value;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      runs: { type: "string", default: "1" },
      case: { type: "string", multiple: true, default: [] },
      "min-pass": { type: "string" },
      "no-save": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
    throw new EvalUsageError("--runs must be a whole number from 1 to 20");
  }

  loadDotEnv();
  const config = loadConfig(process.env, repoRoot);
  disableTracing(process.env);
  const tracing = initTracing(config.tracing);
  const minPass =
    fraction("--min-pass", values["min-pass"]) ?? (config.llm.provider === "fake" ? 1 : 0);

  try {
    const outcome = await evaluate({ config, caseIds: values.case, runs });
    console.log(formatReport(outcome.results, outcome.summary, outcome.meta));

    if (!values["no-save"]) {
      const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
      const file = path.join(
        import.meta.dirname,
        "results",
        `${stamp}-${outcome.meta.provider}.json`,
      );
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(outcome, null, 2)}\n`);
      console.log(`\nSaved ${path.relative(repoRoot, file)}`);
    }

    const { summary } = outcome;
    if (summary.criticalFailures.length > 0) return 1;
    if (summary.passRate < minPass) {
      console.log(
        `Pass rate ${Math.round(summary.passRate * 100)}% is below the minimum ${Math.round(minPass * 100)}%.`,
      );
      return 1;
    }
    return 0;
  } finally {
    await tracing.shutdown().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Config and usage errors list names only. Anything else is reported by class, because a
    // message could carry text from a conversation.
    const known = error instanceof ConfigError || error instanceof EvalUsageError;
    console.error(
      known
        ? error.message
        : `Eval failed: ${error instanceof Error ? error.name : "unknown error"}`,
    );
    process.exit(2);
  },
);
