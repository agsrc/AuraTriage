import type { Server } from "node:http";
import path from "node:path";
import { createApp } from "../../src/api/app.js";
import { ChatService } from "../../src/chat/service.js";
import { buildTriageGraph } from "../../src/graph/build.js";
import { createDemoLlm } from "../../src/llm/demo.js";
import type { LlmPort } from "../../src/llm/port.js";
import { createLogger } from "../../src/logger.js";
import { connectEhr, type EhrConnection } from "../../src/mcp/ehr.js";
import { createPersistence, type Persistence } from "../../src/persistence/index.js";

export const MOCK_EHR = path.resolve(import.meta.dirname, "..", "..", "dev", "mock-ehr-server.mjs");
export const TEST_SECRET = "test-secret-with-enough-length";
export const DEMO_PATIENTS = ["P-1001", "P-1002", "P-1003", "P-1004", "P-1005"];

export interface TestApp {
  baseUrl: string;
  /** Every log line the app wrote, as raw JSON strings. */
  logs: string[];
  chat: ChatService;
  stop(): Promise<void>;
}

export interface StartOptions {
  llm?: LlmPort;
  persistence?: Persistence;
  /** Reuse a running EHR connection instead of spawning one per app. */
  ehr?: EhrConnection;
  demoLoginEnabled?: boolean;
}

/** The whole stack in-process: Express, chat service, graph, real MCP adapter and hook, mock EHR over stdio. */
export async function startTestApp(options: StartOptions = {}): Promise<TestApp> {
  const ehr = options.ehr ?? (await connectEhr({ command: process.execPath, args: [MOCK_EHR] }));
  const persistence = options.persistence ?? createPersistence(null);
  const logs: string[] = [];
  const logger = createLogger("debug", { write: (line: string) => void logs.push(line) });
  const now = () => new Date();

  const graph = buildTriageGraph(
    { llm: options.llm ?? createDemoLlm(), tools: ehr.tools, now },
    persistence.checkpointer,
  );
  const chat = new ChatService({ graph, stores: persistence.stores, logger, now });
  const app = createApp({
    config: {
      jwtSecret: TEST_SECRET,
      demoLoginEnabled: options.demoLoginEnabled ?? true,
      demoPatientIds: DEMO_PATIENTS,
    },
    chat,
    logger,
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Test server did not bind to a port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    logs,
    chat,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (options.ehr === undefined) await ehr.close();
      if (options.persistence === undefined) persistence.close();
    },
  };
}

export interface HttpResult {
  status: number;
  headers: Headers;
  body: unknown;
}

export async function http(
  app: TestApp,
  method: "GET" | "POST",
  route: string,
  options: { token?: string; body?: unknown; rawBody?: string } = {},
): Promise<HttpResult> {
  const response = await fetch(`${app.baseUrl}${route}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined || options.rawBody !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === "" ? null : JSON.parse(text),
  };
}

export async function login(
  app: TestApp,
  role: "patient" | "nurse",
  patientId?: string,
): Promise<string> {
  const result = await http(app, "POST", "/api/auth/demo-login", { body: { role, patientId } });
  if (
    result.status !== 200 ||
    typeof result.body !== "object" ||
    result.body === null ||
    !("token" in result.body)
  ) {
    throw new Error(`Login failed with status ${result.status}`);
  }
  return String(result.body.token);
}
