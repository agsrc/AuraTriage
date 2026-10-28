import type { EscalationReason, RedFlagCategory } from "../src/contracts.js";

/** What happened to one tool call the model asked for. */
export type ToolOutcome =
  /** The tool ran and returned a result. */
  | "ok"
  /** The tool ran and failed. */
  | "error"
  /** The graph refused it: not on the agent's allowlist, or a booking without confirmation. */
  | "refused"
  /** No result yet because the run paused first. */
  | "pending";

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  outcome: ToolOutcome;
}

/** Everything observed in one patient message and the system's answer to it. */
export interface TurnRecord {
  patientText: string;
  toolCalls: ToolCallRecord[];
  /** The last assistant message the patient would see this turn. */
  reply?: string;
  /** True when the static emergency notice was shown. */
  emergencyNotice: boolean;
  /** Set when the run stopped for a nurse. */
  paused?: { reason: EscalationReason; categories: RedFlagCategory[] };
  /** How many times the model was called. Zero is the point of the red-flag gate. */
  modelCalls: number;
  /** The error class if the turn failed (model down, too many steps). Never a message. */
  error?: string;
  ms: number;
}

export interface CaseRecord {
  caseId: string;
  turns: TurnRecord[];
}

export interface CheckResult {
  pass: boolean;
  detail: string;
}

export interface Check {
  id: string;
  /**
   * A critical check guards something that must hold whatever the model does (an emergency is
   * escalated, nothing is booked without consent, no other patient's data leaks). A failure makes
   * the whole run fail, even in report-only mode.
   */
  critical: boolean;
  evaluate(record: CaseRecord): CheckResult;
}

export type Category =
  | "triage"
  | "booking"
  | "escalation"
  | "injection"
  | "safety_gate"
  | "robustness";

export interface EvalCase {
  id: string;
  category: Category;
  /** What this case is probing, in one line. All data is synthetic. */
  description: string;
  patientId: string;
  /** Patient messages, sent one after another in one conversation. */
  turns: string[];
  checks: Check[];
}
