// @vitest-environment node
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApiClient } from "../src/api/client";

/**
 * The real web client against the real orchestrator process (offline model, stand-in EHR).
 * It proves the Zod schemas the browser relies on match what the server actually sends.
 */
const ORCHESTRATOR_DIR = path.resolve(import.meta.dirname, "..", "..", "agent-orchestrator");
const ListeningLine = z.object({ event: z.literal("listening"), port: z.number() });

let server: ChildProcess;
let baseUrl = "";

beforeAll(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: ORCHESTRATOR_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "0",
      LOG_LEVEL: "info",
      EHR_MCP_SERVER: "mock",
      LLM_PROVIDER: "fake",
      PERSISTENCE: "memory",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: string[] = [];
  server.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  server.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

  const deadline = Date.now() + 30_000;
  while (baseUrl === "" && Date.now() < deadline) {
    for (const line of chunks.join("").split("\n")) {
      try {
        const parsed = ListeningLine.safeParse(JSON.parse(line));
        if (parsed.success) baseUrl = `http://127.0.0.1:${parsed.data.port}`;
      } catch {
        // not a JSON line
      }
    }
    if (baseUrl === "") await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (baseUrl === "")
    throw new Error(`Orchestrator did not start:\n${chunks.join("").slice(-800)}`);
});

afterAll(async () => {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
});

describe("web client against the real orchestrator", () => {
  it("walks sign-in, a normal turn, an escalation and the nurse's decision", async () => {
    const api = createApiClient({ baseUrl });
    const patient = await api.demoLogin({ role: "patient", patientId: "P-1002" });
    const nurse = await api.demoLogin({ role: "nurse" });
    expect(patient).toMatchObject({ role: "patient", patientId: "P-1002" });

    const calm = await api.sendMessage(patient.token, { message: "I have a mild cough" });
    expect(calm.status).toBe("responded");
    expect(calm.messages[0]).toMatchObject({ role: "assistant" });

    const urgent = await api.sendMessage(patient.token, { message: "I have chest pain" });
    expect(urgent.status).toBe("awaiting_nurse");
    expect(urgent.emergencyNotice).toContain("911");
    expect(urgent.messages[0]?.role).toBe("system");

    const held = await api.getThread(patient.token, urgent.threadId);
    expect(held.status).toBe("awaiting_nurse");

    const queue = await api.listEscalations(nurse.token, "pending");
    expect(queue.find((entry) => entry.threadId === urgent.threadId)).toMatchObject({
      patientId: "P-1002",
      reason: "red_flag",
      categories: ["chest_pain"],
    });

    const detail = await api.getEscalation(nurse.token, urgent.threadId);
    expect(detail.transcript.map((entry) => entry.role)).toEqual(["patient", "system"]);

    const resolved = await api.resolveEscalation(nurse.token, urgent.threadId, {
      decision: "edit",
      editedReply: "Please come in today.",
      note: "Phoned the patient.",
    });
    expect(resolved).toEqual({ threadId: urgent.threadId, status: "resolved" });

    const after = await api.getThread(patient.token, urgent.threadId);
    expect(after.status).toBe("responded");
    expect(after.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Please come in today.",
    });
    expect(after.messages.map((entry) => entry.content)).not.toContain("Phoned the patient.");
  });

  it("carries a model-requested review with the assistant's concern", async () => {
    const api = createApiClient({ baseUrl });
    const patient = await api.demoLogin({ role: "patient", patientId: "P-1001" });
    const nurse = await api.demoLogin({ role: "nurse" });

    const sent = await api.sendMessage(patient.token, {
      message: "I feel dizzy and have a headache",
    });
    const detail = await api.getEscalation(nurse.token, sent.threadId);

    expect(sent.status).toBe("awaiting_nurse");
    expect(sent.emergencyNotice).toBeUndefined();
    expect(detail).toMatchObject({ reason: "high_risk_output", status: "pending" });
    expect(detail.concern).toBeDefined();
    expect(detail.proposedReply).toBeDefined();
  });

  it("maps server errors to typed client errors", async () => {
    const api = createApiClient({ baseUrl });
    const patient = await api.demoLogin({ role: "patient", patientId: "P-1003" });
    const other = await api.demoLogin({ role: "patient", patientId: "P-1004" });
    const thread = await api.sendMessage(patient.token, { message: "I have a mild cough" });

    await expect(api.getThread(other.token, thread.threadId)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    await expect(api.listEscalations(patient.token)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    await expect(api.listEscalations("not-a-token")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    await expect(api.demoLogin({ role: "patient", patientId: "P-9999" })).rejects.toMatchObject({
      code: "validation_error",
    });
  });
});
