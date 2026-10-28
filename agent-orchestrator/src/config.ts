import path from "node:path";
import { z } from "zod";
import { PATIENT_ID_PATTERN } from "./contracts.js";

const DEV_JWT_SECRET = "dev-only-change-me";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
  ENABLE_DEMO_LOGIN: z.stringbool().optional(),
  DEMO_PATIENT_IDS: z.string().default("P-1001,P-1002,P-1003,P-1004,P-1005"),
  LLM_PROVIDER: z.enum(["fake", "anthropic", "ollama"]).default("fake"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  OLLAMA_BASE_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3:8b"),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).max(131072).default(8192),
  OTEL_ENABLED: z.stringbool().default(false),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z
    .url({ protocol: /^https?$/ })
    .default("http://localhost:6006/v1/traces"),
  OTEL_SERVICE_NAME: z.string().min(1).default("auratriage"),
  EHR_MCP_SERVER: z.enum(["jar", "mock"]).default("jar"),
  EHR_MCP_JAR: z.string().min(1).default("ehr-mcp-server/target/ehr-mcp-server.jar"),
  JAVA_BIN: z.string().min(1).optional(),
  PERSISTENCE: z.enum(["sqlite", "memory"]).default("sqlite"),
  CHECKPOINT_DB: z.string().min(1).default("agent-orchestrator/data/checkpoints.sqlite"),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  jwtSecret: string;
  demoLoginEnabled: boolean;
  demoPatientIds: readonly string[];
  llm:
    | { provider: "fake" }
    | { provider: "anthropic"; apiKey: string; model: string }
    | { provider: "ollama"; baseUrl: string; model: string; numCtx: number };
  /** OpenTelemetry export of metadata-only spans. Off unless OTEL_ENABLED=true. */
  tracing: { enabled: boolean; endpoint: string; serviceName: string };
  ehrServer: { command: string; args: readonly string[] };
  /** Absolute path of the SQLite file, or null to keep everything in memory. */
  databasePath: string | null;
}

export class ConfigError extends Error {}

/** Treats empty strings (as in `KEY=` lines of .env) as unset. */
function withoutEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== "") {
      result[key] = value;
    }
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv, repoRoot: string): Config {
  const parsed = EnvSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    // Names only: values may be secrets.
    const keys = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new ConfigError(`Invalid environment configuration: ${keys}`);
  }
  const vars = parsed.data;
  const production = vars.NODE_ENV === "production";

  if (production && vars.JWT_SECRET === DEV_JWT_SECRET) {
    throw new ConfigError("JWT_SECRET must be set to a real secret in production");
  }
  const demoLoginEnabled = vars.ENABLE_DEMO_LOGIN ?? !production;
  if (production && demoLoginEnabled) {
    throw new ConfigError("Demo login must not be enabled in production");
  }

  const demoPatientIds = vars.DEMO_PATIENT_IDS.split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (demoPatientIds.some((id) => !PATIENT_ID_PATTERN.test(id))) {
    throw new ConfigError("Invalid environment configuration: DEMO_PATIENT_IDS");
  }

  let llm: Config["llm"];
  if (vars.LLM_PROVIDER === "anthropic") {
    if (vars.ANTHROPIC_API_KEY === undefined) {
      throw new ConfigError("Invalid environment configuration: ANTHROPIC_API_KEY");
    }
    llm = { provider: "anthropic", apiKey: vars.ANTHROPIC_API_KEY, model: vars.ANTHROPIC_MODEL };
  } else if (vars.LLM_PROVIDER === "ollama") {
    llm = {
      provider: "ollama",
      baseUrl: vars.OLLAMA_BASE_URL,
      model: vars.OLLAMA_MODEL,
      numCtx: vars.OLLAMA_NUM_CTX,
    };
  } else {
    llm = { provider: "fake" };
  }

  const ehrServer =
    vars.EHR_MCP_SERVER === "mock"
      ? {
          command: process.execPath,
          args: [path.join(repoRoot, "agent-orchestrator", "dev", "mock-ehr-server.mjs")],
        }
      : {
          command:
            vars.JAVA_BIN ?? (env.JAVA_HOME ? path.join(env.JAVA_HOME, "bin", "java") : "java"),
          args: ["-jar", path.resolve(repoRoot, vars.EHR_MCP_JAR)],
        };

  return {
    nodeEnv: vars.NODE_ENV,
    port: vars.PORT,
    logLevel: vars.LOG_LEVEL,
    jwtSecret: vars.JWT_SECRET,
    demoLoginEnabled,
    demoPatientIds,
    llm,
    tracing: {
      enabled: vars.OTEL_ENABLED,
      endpoint: vars.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      serviceName: vars.OTEL_SERVICE_NAME,
    },
    ehrServer,
    databasePath: vars.PERSISTENCE === "memory" ? null : path.resolve(repoRoot, vars.CHECKPOINT_DB),
  };
}

/**
 * Traces would carry patient messages to a third party, so tracing is forced off whatever the
 * environment says. Returns true if something had to be overridden.
 */
export function disableTracing(env: NodeJS.ProcessEnv): boolean {
  const flags = [
    "LANGSMITH_TRACING",
    "LANGSMITH_TRACING_V2",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_TRACING",
  ];
  let overridden = false;
  for (const flag of flags) {
    if (env[flag] !== undefined && env[flag] !== "false") {
      overridden = true;
    }
    env[flag] = "false";
  }
  return overridden;
}
