import http from "node:http";
import type { AddressInfo } from "node:net";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createOllamaLlm } from "../src/llm/ollama.js";
import { LlmUnavailableError } from "../src/llm/port.js";

interface ChatRequest {
  model?: string;
  think?: boolean;
  options?: { num_ctx?: number };
  tools?: unknown[];
}

const ChatRequestSchema = z.object({
  model: z.string().optional(),
  think: z.boolean().optional(),
  options: z.object({ num_ctx: z.number().optional() }).optional(),
  tools: z.array(z.unknown()).optional(),
});

interface FakeOllama {
  baseUrl: string;
  requests: ChatRequest[];
  close(): Promise<void>;
}

/** A stand-in for Ollama's /api/chat that answers with newline-delimited JSON, as the real one does. */
async function startFakeOllama(
  message: Record<string, unknown>,
  status = 200,
): Promise<FakeOllama> {
  const requests: ChatRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      requests.push(ChatRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      if (status !== 200) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "model not found" }));
        return;
      }
      const base = { model: "fake", created_at: new Date().toISOString() };
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(`${JSON.stringify({ ...base, message, done: false })}\n`);
      res.end(
        `${JSON.stringify({
          ...base,
          message: { role: "assistant", content: "" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 4,
          eval_count: 2,
        })}\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? (address as AddressInfo).port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const lookup = tool(async () => "ok", {
  name: "lookup",
  description: "Looks something up.",
  schema: z.object({ term: z.string() }),
});

describe("createOllamaLlm", () => {
  const open: FakeOllama[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((fake) => fake.close()));
  });

  async function fake(message: Record<string, unknown>, status?: number): Promise<FakeOllama> {
    const instance = await startFakeOllama(message, status);
    open.push(instance);
    return instance;
  }

  it("returns the model's text and sends the configured model, context size and no thinking", async () => {
    const server = await fake({ role: "assistant", content: "Drink water." });
    const llm = createOllamaLlm({ baseUrl: server.baseUrl, model: "tiny:1b", numCtx: 4096 });

    const reply = await llm.complete([new HumanMessage("hello")], {});

    expect(reply.content).toBe("Drink water.");
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      model: "tiny:1b",
      think: false,
      options: { num_ctx: 4096 },
    });
  });

  it("offers tools to the model and returns the calls it asks for", async () => {
    const server = await fake({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "lookup", arguments: { term: "bp" } } }],
    });
    const llm = createOllamaLlm({ baseUrl: server.baseUrl, model: "tiny:1b", numCtx: 4096 });

    const reply = await llm.completeWithTools([new HumanMessage("check")], [lookup], {});

    expect(server.requests[0]?.tools).toHaveLength(1);
    expect(reply.tool_calls?.map((call) => [call.name, call.args])).toEqual([
      ["lookup", { term: "bp" }],
    ]);
  });

  it("reports an unreachable daemon as the model being unavailable", async () => {
    const server = await fake({ role: "assistant", content: "unused" });
    const baseUrl = server.baseUrl;
    await server.close();
    open.length = 0;
    const llm = createOllamaLlm({ baseUrl, model: "tiny:1b", numCtx: 4096 });

    await expect(llm.complete([new HumanMessage("hello")], {})).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });

  it("reports a missing model as the model being unavailable", async () => {
    const server = await fake({ role: "assistant", content: "unused" }, 404);
    const llm = createOllamaLlm({ baseUrl: server.baseUrl, model: "missing:1b", numCtx: 4096 });

    await expect(
      llm.completeWithTools([new HumanMessage("hello")], [lookup], {}),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});
