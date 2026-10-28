import type { CaseRecord, Category, EvalCase } from "./model.js";

export interface CheckOutcome {
  checkId: string;
  critical: boolean;
  pass: boolean;
  detail: string;
}

export interface CaseResult {
  caseId: string;
  category: Category;
  run: number;
  record: CaseRecord;
  outcomes: CheckOutcome[];
  /** Every check passed. */
  passed: boolean;
}

export function scoreCase(evalCase: EvalCase, run: number, record: CaseRecord): CaseResult {
  const outcomes = evalCase.checks.map((check) => ({
    checkId: check.id,
    critical: check.critical,
    ...check.evaluate(record),
  }));
  return {
    caseId: evalCase.id,
    category: evalCase.category,
    run,
    record,
    outcomes,
    passed: outcomes.every((outcome) => outcome.pass),
  };
}

interface Tally {
  passed: number;
  total: number;
}

export interface Summary {
  runs: number;
  caseRuns: number;
  passedCaseRuns: number;
  passRate: number;
  byCategory: Record<string, Tally>;
  byCheck: Record<string, Tally>;
  criticalFailures: { caseId: string; run: number; checkId: string; detail: string }[];
  /** Cases that passed in some runs and failed in others: the model is not reliable here. */
  flaky: string[];
  turns: number;
  turnErrors: number;
  latencyMs: { p50: number; p95: number };
  meanToolCallsPerTurn: number;
}

function tally(into: Record<string, Tally>, key: string, pass: boolean): void {
  const current = into[key] ?? { passed: 0, total: 0 };
  into[key] = { passed: current.passed + (pass ? 1 : 0), total: current.total + 1 };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function summarize(results: readonly CaseResult[]): Summary {
  const byCategory: Record<string, Tally> = {};
  const byCheck: Record<string, Tally> = {};
  const outcomesByCase = new Map<string, boolean[]>();
  const criticalFailures: Summary["criticalFailures"] = [];

  for (const result of results) {
    tally(byCategory, result.category, result.passed);
    outcomesByCase.set(result.caseId, [
      ...(outcomesByCase.get(result.caseId) ?? []),
      result.passed,
    ]);
    for (const outcome of result.outcomes) {
      tally(byCheck, outcome.checkId, outcome.pass);
      if (outcome.critical && !outcome.pass) {
        criticalFailures.push({
          caseId: result.caseId,
          run: result.run,
          checkId: outcome.checkId,
          detail: outcome.detail,
        });
      }
    }
  }

  const turns = results.flatMap((result) => result.record.turns);
  const times = turns.map((turn) => turn.ms).sort((a, b) => a - b);
  const toolCalls = turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0);
  const passedCaseRuns = results.filter((result) => result.passed).length;

  return {
    runs: new Set(results.map((result) => result.run)).size,
    caseRuns: results.length,
    passedCaseRuns,
    passRate: results.length === 0 ? 0 : passedCaseRuns / results.length,
    byCategory,
    byCheck,
    criticalFailures,
    flaky: [...outcomesByCase]
      .filter(([, passes]) => passes.some(Boolean) && !passes.every(Boolean))
      .map(([caseId]) => caseId),
    turns: turns.length,
    turnErrors: turns.filter((turn) => turn.error !== undefined).length,
    latencyMs: { p50: percentile(times, 0.5), p95: percentile(times, 0.95) },
    meanToolCallsPerTurn: turns.length === 0 ? 0 : toolCalls / turns.length,
  };
}

const pct = (tallyValue: Tally): string =>
  `${tallyValue.passed}/${tallyValue.total} (${Math.round((100 * tallyValue.passed) / tallyValue.total)}%)`;

export interface ReportMeta {
  provider: string;
  model: string;
  ehr: string;
}

/** The human-readable report: one line per case, then the totals. */
export function formatReport(
  results: readonly CaseResult[],
  summary: Summary,
  meta: ReportMeta,
): string {
  const lines: string[] = [];
  lines.push(
    `AuraTriage eval: ${meta.provider} (${meta.model}), EHR ${meta.ehr}, ${summary.runs} run(s)`,
  );
  lines.push(
    "All conversations are synthetic. Expectations grade behaviour, not clinical advice.",
    "",
  );

  for (const result of results) {
    const failed = result.outcomes.filter((outcome) => !outcome.pass);
    const mark = result.passed ? "PASS" : "FAIL";
    const run = summary.runs > 1 ? ` #${result.run}` : "";
    lines.push(`${mark}  ${result.caseId}${run}`);
    for (const outcome of failed) {
      const tag = outcome.critical ? " [critical]" : "";
      lines.push(`      - ${outcome.checkId}${tag}: ${outcome.detail}`);
    }
  }

  lines.push("", "By category");
  for (const [name, value] of Object.entries(summary.byCategory)) {
    lines.push(`  ${name.padEnd(14)} ${pct(value)}`);
  }
  const weak = Object.entries(summary.byCheck).filter(([, value]) => value.passed < value.total);
  if (weak.length > 0) {
    lines.push("", "Checks that failed somewhere");
    for (const [name, value] of weak) lines.push(`  ${name.padEnd(34)} ${pct(value)}`);
  }
  if (summary.flaky.length > 0) {
    lines.push("", `Flaky (mixed results across runs): ${summary.flaky.join(", ")}`);
  }
  lines.push(
    "",
    `Overall      ${summary.passedCaseRuns}/${summary.caseRuns} case runs (${Math.round(summary.passRate * 100)}%)`,
    `Latency      p50 ${summary.latencyMs.p50} ms, p95 ${summary.latencyMs.p95} ms per turn`,
    `Tool calls   ${summary.meanToolCallsPerTurn.toFixed(2)} per turn`,
    `Failed turns ${summary.turnErrors}/${summary.turns} (model unreachable or too many steps)`,
    `Critical     ${summary.criticalFailures.length === 0 ? "none failed" : `${summary.criticalFailures.length} FAILED`}`,
  );
  return lines.join("\n");
}
