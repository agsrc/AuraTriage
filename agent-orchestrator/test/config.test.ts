import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, disableTracing, loadConfig } from "../src/config.js";

const ROOT = path.resolve("/repo");

describe("loadConfig", () => {
  it("applies safe defaults for development", () => {
    const config = loadConfig({}, ROOT);

    expect(config.port).toBe(3001);
    expect(config.llm).toEqual({ provider: "fake" });
    expect(config.demoLoginEnabled).toBe(true);
    expect(config.demoPatientIds).toEqual(["P-1001", "P-1002", "P-1003", "P-1004", "P-1005"]);
    expect(config.databasePath).toBe(
      path.resolve(ROOT, "agent-orchestrator/data/checkpoints.sqlite"),
    );
    expect(config.ehrServer.command).toBe("java");
    expect(config.ehrServer.args).toEqual([
      "-jar",
      path.resolve(ROOT, "ehr-mcp-server/target/ehr-mcp-server.jar"),
    ]);
  });

  it("treats empty .env values as unset", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "", JAVA_BIN: "", PORT: "" }, ROOT);

    expect(config.port).toBe(3001);
    expect(config.llm.provider).toBe("fake");
  });

  it("prefers JAVA_BIN, then JAVA_HOME, then java on the PATH", () => {
    expect(loadConfig({ JAVA_BIN: "/opt/jdk/bin/java" }, ROOT).ehrServer.command).toBe(
      "/opt/jdk/bin/java",
    );
    expect(loadConfig({ JAVA_HOME: "/opt/jdk" }, ROOT).ehrServer.command).toBe(
      path.join("/opt/jdk", "bin", "java"),
    );
  });

  it("points at the mock EHR when asked", () => {
    const { ehrServer } = loadConfig({ EHR_MCP_SERVER: "mock" }, ROOT);

    expect(ehrServer.command).toBe(process.execPath);
    expect(ehrServer.args).toEqual([
      path.join(ROOT, "agent-orchestrator", "dev", "mock-ehr-server.mjs"),
    ]);
  });

  it("keeps everything in memory when persistence is memory", () => {
    expect(loadConfig({ PERSISTENCE: "memory" }, ROOT).databasePath).toBeNull();
  });

  it("requires an API key for the anthropic provider", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "anthropic" }, ROOT)).toThrow(ConfigError);
    const config = loadConfig({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }, ROOT);
    expect(config.llm).toEqual({ provider: "anthropic", apiKey: "k", model: "claude-sonnet-5-5" });
  });

  it("defaults the ollama provider to a local daemon and a small model", () => {
    const config = loadConfig({ LLM_PROVIDER: "ollama" }, ROOT);

    expect(config.llm).toEqual({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "qwen3:8b",
      numCtx: 8192,
    });
  });

  it("reads the ollama settings and rejects bad ones by name", () => {
    const config = loadConfig(
      {
        LLM_PROVIDER: "ollama",
        OLLAMA_BASE_URL: "http://127.0.0.1:9999",
        OLLAMA_MODEL: "llama3.2:3b",
        OLLAMA_NUM_CTX: "4096",
      },
      ROOT,
    );
    expect(config.llm).toEqual({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:9999",
      model: "llama3.2:3b",
      numCtx: 4096,
    });
    expect(() => loadConfig({ OLLAMA_BASE_URL: "not a url" }, ROOT)).toThrow(/OLLAMA_BASE_URL/);
    expect(() => loadConfig({ OLLAMA_NUM_CTX: "10" }, ROOT)).toThrow(/OLLAMA_NUM_CTX/);
  });

  it("rejects a malformed demo patient list", () => {
    expect(() => loadConfig({ DEMO_PATIENT_IDS: "P-1001,bob" }, ROOT)).toThrow(ConfigError);
  });

  it("refuses the development secret and demo login in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" }, ROOT)).toThrow(/JWT_SECRET/);
    expect(() =>
      loadConfig(
        { NODE_ENV: "production", JWT_SECRET: "x".repeat(32), ENABLE_DEMO_LOGIN: "true" },
        ROOT,
      ),
    ).toThrow(/Demo login/);
    const config = loadConfig({ NODE_ENV: "production", JWT_SECRET: "x".repeat(32) }, ROOT);
    expect(config.demoLoginEnabled).toBe(false);
  });

  it("does not leak secret values in error messages", () => {
    try {
      loadConfig({ JWT_SECRET: "short" }, ROOT);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("JWT_SECRET");
      expect(String(error)).not.toContain("short");
    }
  });
});

describe("disableTracing", () => {
  it("forces every tracing flag to false and reports an override", () => {
    const env: NodeJS.ProcessEnv = { LANGSMITH_TRACING: "true", LANGCHAIN_TRACING_V2: "true" };

    expect(disableTracing(env)).toBe(true);
    expect(env.LANGSMITH_TRACING).toBe("false");
    expect(env.LANGCHAIN_TRACING_V2).toBe("false");
    expect(env.LANGSMITH_TRACING_V2).toBe("false");
    expect(env.LANGCHAIN_TRACING).toBe("false");
  });

  it("reports no override when tracing was already off or unset", () => {
    expect(disableTracing({ LANGSMITH_TRACING: "false" })).toBe(false);
    expect(disableTracing({})).toBe(false);
  });
});
