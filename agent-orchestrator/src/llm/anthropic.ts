import { ChatAnthropic } from "@langchain/anthropic";
import { type LlmPort, LlmUnavailableError } from "./port.js";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
}

/**
 * Claude via LangChain. Sampling parameters are left at the provider defaults on purpose: some
 * newer models reject explicit `temperature`. Not exercised by the offline test suite, which uses
 * the demo model, so it needs a manual check with a real key.
 */
export function createAnthropicLlm(options: AnthropicOptions): LlmPort {
  const model = new ChatAnthropic({
    apiKey: options.apiKey,
    model: options.model,
    maxTokens: 1024,
  });

  async function guard<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw new LlmUnavailableError("The language model request failed", { cause: error });
    }
  }

  return {
    complete: (messages, config) => guard(() => model.invoke([...messages], config)),
    completeWithTools: (messages, tools, config) =>
      guard(() => model.bindTools([...tools]).invoke([...messages], config)),
  };
}
