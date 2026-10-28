import path from "node:path";
import { createApp } from "./api/app.js";
import { ChatService } from "./chat/service.js";
import { type Config, ConfigError, disableTracing, loadConfig } from "./config.js";
import { buildTriageGraph } from "./graph/build.js";
import { createAnthropicLlm } from "./llm/anthropic.js";
import { createDemoLlm } from "./llm/demo.js";
import { createOllamaLlm } from "./llm/ollama.js";
import type { LlmPort } from "./llm/port.js";
import { createLogger } from "./logger.js";
import { connectEhr } from "./mcp/ehr.js";
import { createPersistence } from "./persistence/index.js";
import { withLlmTracing } from "./telemetry/spans.js";
import { initTracing } from "./telemetry/tracing.js";

// src/ and dist/ both sit directly under agent-orchestrator/, which sits under the repo root.
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function loadDotEnv(): void {
  try {
    process.loadEnvFile(path.join(repoRoot, ".env"));
  } catch {
    // No .env file: use the real environment only.
  }
}

function createLlm(llm: Config["llm"]): LlmPort {
  switch (llm.provider) {
    case "anthropic":
      return createAnthropicLlm(llm);
    case "ollama":
      return createOllamaLlm(llm);
    case "fake":
      return createDemoLlm();
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig(process.env, repoRoot);
  const tracingWasOn = disableTracing(process.env);
  const logger = createLogger(config.logLevel);
  if (tracingWasOn) {
    logger.warn(
      { event: "tracing_forced_off" },
      "LangSmith tracing was requested but is disabled: traces would carry patient messages",
    );
  }

  const persistence = createPersistence(config.databasePath);
  const ehr = await connectEhr(config.ehrServer);
  const tracing = initTracing(config.tracing);
  if (tracing.enabled) {
    logger.info({ event: "tracing_enabled", endpoint: config.tracing.endpoint }, "tracing enabled");
  }
  const llm = withLlmTracing(
    createLlm(config.llm),
    config.llm.provider === "fake" ? "demo" : config.llm.model,
  );
  const graph = buildTriageGraph(
    { llm, tools: ehr.tools, now: () => new Date() },
    persistence.checkpointer,
  );
  const chat = new ChatService({
    graph,
    stores: persistence.stores,
    logger,
    now: () => new Date(),
  });
  const app = createApp({ config, chat, logger });

  const server = app.listen(config.port, () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : config.port;
    logger.info(
      { event: "listening", port, llm: config.llm.provider, durable: persistence.durable },
      "orchestrator listening",
    );
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ event: "shutdown", signal }, "shutting down");
    server.close(async () => {
      await ehr.close().catch(() => undefined);
      await tracing.shutdown().catch(() => undefined);
      persistence.close();
      process.exit(0);
    });
    // Do not hang on keep-alive connections.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(signal, () => shutdown(signal));
  }
}

main().catch((error: unknown) => {
  // Config errors list variable names only; other errors are reported by name.
  const message =
    error instanceof ConfigError
      ? error.message
      : `Failed to start: ${error instanceof Error ? error.name : "unknown error"}`;
  console.error(message);
  process.exit(1);
});
