import { AIMessage, type BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { type NurseResolution, NurseResolutionSchema, type RedFlagCategory } from "../contracts.js";
import type { LlmPort } from "../llm/port.js";
import { EHR_TOOL, type EhrTools } from "../mcp/ehr.js";
import { detectRedFlags, EMERGENCY_NOTICE } from "../safety/redFlags.js";
import {
  LOCAL_TOOL,
  ProposeBookingArgsSchema,
  proposeBookingTool,
  ReviewArgsSchema,
  requestNurseReviewTool,
} from "./localTools.js";
import {
  assistantMessage,
  emergencyNoticeMessage,
  humanTurnCount,
  lastAiMessage,
  latestHumanText,
  modelMessages,
  NURSE_APPROVED_GENERIC_TEXT,
  NURSE_APPROVED_RED_FLAG_TEXT,
  NURSE_REJECTED_TEXT,
  nurseNoteMessage,
  stampReply,
  textOfOutput,
} from "./messages.js";
import { PROMPTS } from "./prompts.js";
import type {
  EscalationPayload,
  EscalationState,
  Intent,
  PendingBooking,
  TriageState,
  TriageUpdate,
} from "./state.js";

/** Optional extra screen. It can only add categories; if it fails the gate escalates anyway. */
export type RiskClassifier = (text: string) => Promise<readonly RedFlagCategory[]>;

export interface GraphDeps {
  llm: LlmPort;
  tools: EhrTools;
  riskClassifier?: RiskClassifier;
  now: () => Date;
}

/** Per-agent allowlist: a model cannot reach a tool its role was not given, whatever it asks for. */
const TOOLS_FOR_INTENT: Record<Intent, readonly string[]> = {
  triage: [EHR_TOOL.history, LOCAL_TOOL.requestNurseReview],
  booking: [
    EHR_TOOL.availability,
    LOCAL_TOOL.proposeBooking,
    EHR_TOOL.book,
    LOCAL_TOOL.requestNurseReview,
  ],
};

function safeErrorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "unknown error";
}

function escalationFromReviewCall(state: TriageState): EscalationState {
  const call = lastAiMessage(state.messages)?.tool_calls?.find(
    (candidate) => candidate.name === LOCAL_TOOL.requestNurseReview,
  );
  if (call === undefined) {
    throw new Error("human_escalation was reached without a reason");
  }
  const args = ReviewArgsSchema.safeParse(call.args);
  return {
    reason: "high_risk_output",
    categories: [],
    concern: args.success ? args.data.concern : "The assistant asked for a nurse review.",
    proposedReply: args.success ? args.data.draftReply : undefined,
  };
}

/** Every tool call in the last AI message needs a result, or the next model call is rejected. */
function closeOpenToolCalls(
  messages: readonly BaseMessage[],
  resolution: NurseResolution,
): ToolMessage[] {
  const last = messages.at(-1);
  if (last === undefined || !AIMessage.isInstance(last)) {
    return [];
  }
  return (last.tool_calls ?? []).map(
    (call, index) =>
      new ToolMessage({
        content:
          call.name === LOCAL_TOOL.requestNurseReview
            ? `Nurse review completed: ${resolution.decision}.`
            : "Not run: the conversation was escalated to a nurse.",
        tool_call_id: call.id ?? `call_${index}`,
        name: call.name,
      }),
  );
}

function finalText(escalation: EscalationState, resolution: NurseResolution): string {
  if (resolution.decision === "edit") {
    return resolution.editedReply ?? NURSE_REJECTED_TEXT;
  }
  if (resolution.decision === "reject") {
    return NURSE_REJECTED_TEXT;
  }
  return (
    escalation.proposedReply ??
    (escalation.reason === "red_flag" ? NURSE_APPROVED_RED_FLAG_TEXT : NURSE_APPROVED_GENERIC_TEXT)
  );
}

export function createNodes(deps: GraphDeps) {
  const registry: Record<string, StructuredToolInterface | undefined> = {
    ...deps.tools,
    [LOCAL_TOOL.requestNurseReview]: requestNurseReviewTool,
    [LOCAL_TOOL.proposeBooking]: proposeBookingTool,
  };

  function toolsFor(intent: Intent): StructuredToolInterface[] {
    return TOOLS_FOR_INTENT[intent].flatMap((name) => {
      const tool = registry[name];
      return tool === undefined ? [] : [tool];
    });
  }

  /** First node on every turn. Deterministic: it never calls a model for the red-flag decision. */
  async function safetyGate(state: TriageState): Promise<TriageUpdate> {
    const text = latestHumanText(state.messages);
    const categories = new Set<RedFlagCategory>(detectRedFlags(text));
    let classifierFailed = false;
    if (deps.riskClassifier !== undefined) {
      try {
        for (const category of await deps.riskClassifier(text)) {
          categories.add(category);
        }
      } catch {
        classifierFailed = true;
      }
    }
    if (categories.size === 0 && !classifierFailed) {
      return { intent: null, escalation: null };
    }
    return {
      intent: null,
      escalation: { reason: "red_flag", categories: [...categories] },
      messages: [emergencyNoticeMessage(EMERGENCY_NOTICE, deps.now())],
    };
  }

  async function patientIntake(state: TriageState, config: RunnableConfig): Promise<TriageUpdate> {
    const reply = await deps.llm.complete(
      [new SystemMessage(PROMPTS.intake), ...modelMessages(state.messages)],
      config,
    );
    const intent: Intent = /\bbooking\b/i.test(reply.text) ? "booking" : "triage";
    return { intent };
  }

  async function runAgent(
    intent: Intent,
    state: TriageState,
    config: RunnableConfig,
  ): Promise<TriageUpdate> {
    const reply = await deps.llm.completeWithTools(
      [new SystemMessage(PROMPTS[intent]), ...modelMessages(state.messages)],
      toolsFor(intent),
      config,
    );
    return { messages: [stampReply(reply, deps.now())] };
  }

  const triageAgent = (state: TriageState, config: RunnableConfig) =>
    runAgent("triage", state, config);
  const bookingAgent = (state: TriageState, config: RunnableConfig) =>
    runAgent("booking", state, config);

  async function toolExecution(state: TriageState, config: RunnableConfig): Promise<TriageUpdate> {
    const allowed = new Set(TOOLS_FOR_INTENT[state.intent ?? "triage"]);
    const calls = lastAiMessage(state.messages)?.tool_calls ?? [];
    const humanTurn = humanTurnCount(state.messages);
    let pendingBooking: PendingBooking | null = state.pendingBooking;
    const results: ToolMessage[] = [];

    for (const [index, call] of calls.entries()) {
      const result = (content: string, status: "success" | "error" = "success") =>
        new ToolMessage({
          content,
          tool_call_id: call.id ?? `call_${index}`,
          name: call.name,
          status,
        });

      if (!allowed.has(call.name)) {
        results.push(result("This tool is not available for the current request.", "error"));
        continue;
      }

      if (call.name === LOCAL_TOOL.proposeBooking) {
        const args = ProposeBookingArgsSchema.safeParse(call.args);
        if (!args.success) {
          results.push(result("slotId must look like S-1234.", "error"));
          continue;
        }
        pendingBooking = { slotId: args.data.slotId, humanTurn };
        results.push(
          result(
            "Recorded. Ask the patient to confirm this slot, then stop and wait for their reply.",
          ),
        );
        continue;
      }

      if (call.name === EHR_TOOL.book) {
        const slotId: unknown = call.args.slotId;
        const confirmed =
          pendingBooking !== null &&
          slotId === pendingBooking.slotId &&
          humanTurn > pendingBooking.humanTurn;
        if (!confirmed) {
          results.push(
            result(
              "Booking refused: propose this slot with propose_booking, then wait for the patient to confirm it in a later message.",
              "error",
            ),
          );
          continue;
        }
      }

      const tool = registry[call.name];
      if (tool === undefined) {
        results.push(result("This tool is not available for the current request.", "error"));
        continue;
      }
      try {
        results.push(result(textOfOutput(await tool.invoke(call.args, config))));
        if (call.name === EHR_TOOL.book) {
          pendingBooking = null;
        }
      } catch (error) {
        results.push(result(`Tool call failed: ${safeErrorText(error)}`, "error"));
      }
    }
    return { messages: results, pendingBooking };
  }

  /**
   * Pauses the whole run until a nurse decides. `interrupt()` is the first thing that happens:
   * LangGraph re-runs this node from the top on resume, so nothing before it may have side effects.
   */
  function humanEscalation(state: TriageState): TriageUpdate {
    const escalation = state.escalation ?? escalationFromReviewCall(state);
    const payload: EscalationPayload = {
      reason: escalation.reason,
      categories: escalation.categories,
      concern: escalation.concern,
      proposedReply: escalation.proposedReply,
    };
    const resumeValue: unknown = interrupt<EscalationPayload, unknown>(payload);
    const resolution = NurseResolutionSchema.parse(resumeValue);

    const messages: BaseMessage[] = closeOpenToolCalls(state.messages, resolution);
    if (resolution.note !== undefined && resolution.note !== "") {
      messages.push(nurseNoteMessage(resolution.note, deps.now()));
    }
    return { escalation: { ...escalation, resolution }, messages };
  }

  function respond(state: TriageState): TriageUpdate {
    const escalation = state.escalation;
    const resolution = escalation?.resolution;
    if (escalation === null || resolution === undefined) {
      return {};
    }
    return { messages: [assistantMessage(finalText(escalation, resolution), deps.now())] };
  }

  return {
    safetyGate,
    patientIntake,
    triageAgent,
    bookingAgent,
    toolExecution,
    humanEscalation,
    respond,
  };
}
