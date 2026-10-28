import type { Config } from "../config.js";
import { createAnthropicLlm } from "./anthropic.js";
import { createDemoLlm } from "./demo.js";
import { createOllamaLlm } from "./ollama.js";
import type { LlmPort } from "./port.js";

/** The model behind `LLM_PROVIDER`. Shared by the server and the eval runner. */
export function createLlm(llm: Config["llm"]): LlmPort {
  switch (llm.provider) {
    case "anthropic":
      return createAnthropicLlm(llm);
    case "ollama":
      return createOllamaLlm(llm);
    case "fake":
      return createDemoLlm();
  }
}

/** A short name for logs, traces and reports. Never a key. */
export function llmLabel(llm: Config["llm"]): string {
  return llm.provider === "fake" ? "demo" : llm.model;
}
