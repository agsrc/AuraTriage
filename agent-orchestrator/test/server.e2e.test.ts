import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const ORCHESTRATOR_DIR = path.resolve(import.meta.dirname, "..");
const ListeningLine = z.object({ event: z.literal("listening"), port: z.number() });
const TokenResponse = z.object({ token: z.string() });

let child: ChildProcess | undefined;

afterEach(async () => {
  if (child !== undefined && child.exitCode === null) {
    const exited = new Promise((resolve) => child?.once("exit", resolve));
    child.kill();
    await exited;
  }
  child = undefined;
});

function startServer(env: Record<string, string>): {
  output: () => string;
  exit: Promise<number | null>;
} {
  const process_ = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: ORCHESTRATOR_DIR,
    env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "info", PERSISTENCE: "memory", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = process_;
  const chunks: string[] = [];
  process_.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  process_.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  return {
    output: () => chunks.join(""),
    exit: new Promise((resolve) => process_.once("exit", (code) => resolve(code))),
  };
}

async function waitForPort(output: () => string, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const line of output().split("\n")) {
      try {
        const parsed = ListeningLine.safeParse(JSON.parse(line));
        if (parsed.success) return parsed.data.port;
      } catch {
        // not a JSON line
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not report that it was listening in time");
}

describe("server entrypoint", () => {
  it("boots with the mock EHR, serves a conversation and keeps patient text out of its output", async () => {
    const { output } = startServer({ PORT: "0", EHR_MCP_SERVER: "mock", LLM_PROVIDER: "fake" });
    const port = await waitForPort(output, 25_000);
    const base = `http://127.0.0.1:${port}`;

    const login = await fetch(`${base}/api/auth/demo-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "patient", patientId: "P-1002" }),
    });
    const { token } = TokenResponse.parse(await login.json());

    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "Ada Quillfeather here, I have a mild cough" }),
    });

    expect(chat.status).toBe(200);
    expect(await chat.json()).toMatchObject({ status: "responded" });
    expect(output()).toContain('"event":"listening"');
    expect(output()).not.toContain("Quillfeather");
    expect(output()).not.toContain(token);
  });

  it("refuses to start with an invalid configuration, naming the setting but not its value", async () => {
    const { output, exit } = startServer({ JWT_SECRET: "too-short", EHR_MCP_SERVER: "mock" });

    expect(await exit).toBe(1);
    expect(output()).toContain("JWT_SECRET");
    expect(output()).not.toContain("too-short");
  });

  it("exits with an error when the EHR server cannot be started", async () => {
    const { output, exit } = startServer({
      EHR_MCP_SERVER: "jar",
      EHR_MCP_JAR: "does/not/exist.jar",
    });

    expect(await exit).toBe(1);
    expect(output()).toContain("Failed to start");
  });
});
