import type { StructuredToolInterface } from "@langchain/core/tools";
import { MCPAdapter, type ToolHooks } from "@langchain/mcp-adapters";
import { PATIENT_ID_PATTERN } from "../contracts.js";

export const EHR_SERVER = "ehr";

/** Names as the adapter exposes them: `{server}_{tool}`. */
export const EHR_TOOL = {
  history: "ehr_get_patient_history",
  availability: "ehr_check_provider_availability",
  book: "ehr_book_appointment",
} as const;
export type EhrToolName = (typeof EHR_TOOL)[keyof typeof EHR_TOOL];

/** The model passes this instead of a real ID; the hook swaps in the signed-in patient. */
export const SESSION_PLACEHOLDER = "SESSION";

/** Raw MCP names (the hook sees them without the `ehr_` prefix) of tools that act on one patient. */
const PATIENT_BOUND_TOOLS: ReadonlySet<string> = new Set([
  "get_patient_history",
  "book_appointment",
]);

export type BeforeToolCall = NonNullable<ToolHooks["beforeToolCall"]>;

/**
 * Binds the authenticated patient to every patient-scoped tool call. The ID comes from
 * `config.configurable.patientId`, which the chat service sets from the verified JWT, and replaces
 * whatever the model supplied. With no signed-in patient the call fails: it never falls through to
 * the model's value.
 */
export const bindSessionPatient: BeforeToolCall = (request, _state, config) => {
  if (!PATIENT_BOUND_TOOLS.has(request.name)) {
    return undefined;
  }
  const patientId: unknown = config?.configurable?.patientId;
  if (typeof patientId !== "string" || !PATIENT_ID_PATTERN.test(patientId)) {
    throw new Error("No signed-in patient is bound to this tool call");
  }
  return { args: { patientId } };
};

export type EhrTools = Record<EhrToolName, StructuredToolInterface>;

export interface EhrConnection {
  tools: EhrTools;
  close(): Promise<void>;
}

export interface EhrServerSpec {
  command: string;
  args: readonly string[];
}

/** Spawns the EHR MCP server over stdio once; call `close()` on shutdown so no JVM is orphaned. */
export async function connectEhr(spec: EhrServerSpec): Promise<EhrConnection> {
  const adapter = new MCPAdapter({
    servers: { [EHR_SERVER]: { command: spec.command, args: [...spec.args], stderr: "inherit" } },
    beforeToolCall: bindSessionPatient,
  });
  try {
    const discovered = await adapter.listTools();
    const byName = new Map(discovered.map((tool) => [tool.name, tool]));
    const history = byName.get(EHR_TOOL.history);
    const availability = byName.get(EHR_TOOL.availability);
    const book = byName.get(EHR_TOOL.book);
    if (!history || !availability || !book) {
      const missing = Object.values(EHR_TOOL).filter((name) => !byName.has(name));
      throw new Error(`EHR MCP server is missing tools: ${missing.join(", ")}`);
    }
    return {
      tools: {
        [EHR_TOOL.history]: history,
        [EHR_TOOL.availability]: availability,
        [EHR_TOOL.book]: book,
      },
      close: () => adapter.close(),
    };
  } catch (error) {
    await adapter.close().catch(() => undefined);
    throw error;
  }
}
