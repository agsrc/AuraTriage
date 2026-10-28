import { ChatOllama } from "@langchain/ollama";
import { type LlmPort, LlmUnavailableError } from "./port.js";

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  /** Context window in tokens. Ollama's own default is small enough to cut off our tool schemas. */
  numCtx: number;
}

/**
 * A model served by a local Ollama daemon, so nothing leaves the machine and nothing costs money.
 * Thinking is turned off: reasoning models would otherwise spend a long time on hidden tokens, and
 * the reply we use is the final answer only. Small models call tools less reliably than Claude;
 * that is safe because the allowlist, patient-ID binding and booking guard sit outside the model.
 */
export function createOllamaLlm(options: OllamaOptions): LlmPort {
  const model = new ChatOllama({
    baseUrl: options.baseUrl,
    model: options.model,
    numCtx: options.numCtx,
    think: false,
    // Keep the weights loaded between turns, so only the first message pays the load time.
    keepAlive: "30m",
  });

  async function guard<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      // Daemon down, model not pulled, or a bad response: all mean "model unavailable" here.
      throw new LlmUnavailableError("The language model request failed", { cause: error });
    }
  }

  return {
    complete: (messages, config) => guard(() => model.invoke([...messages], config)),
    completeWithTools: (messages, tools, config) =>
      guard(() => model.bindTools([...tools]).invoke([...messages], config)),
  };
}
