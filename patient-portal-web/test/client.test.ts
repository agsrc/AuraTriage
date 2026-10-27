import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createApiClient, isApiClientError } from "../src/api/client";

const THREAD = "11111111-1111-4111-8111-111111111111";

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

describe("api client", () => {
  it("sends the token and a JSON body, and parses the response", async () => {
    const fetch = respond(200, { threadId: THREAD, status: "responded", messages: [] });
    const api = createApiClient({ baseUrl: "http://api.test/", fetch });

    const result = await api.sendMessage("tok", { message: "hello" });

    expect(result).toEqual({ threadId: THREAD, status: "responded", messages: [] });
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("sends no authorization header for sign-in", async () => {
    const fetch = respond(200, { token: "t", role: "nurse" });

    await createApiClient({ fetch }).demoLogin({ role: "nurse" });

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("builds paths: encoded thread IDs and the status filter", async () => {
    const fetch = respond(200, []);
    const api = createApiClient({ fetch });

    await api.listEscalations("tok", "pending");
    await api.listEscalations("tok");

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "/api/nurse/escalations?status=pending",
      "/api/nurse/escalations",
    ]);

    const other = respond(200, { threadId: "a/b", status: "responded", messages: [] });
    await createApiClient({ fetch: other }).getThread("tok", "a/b");
    expect(vi.mocked(other).mock.calls[0]?.[0]).toBe("/api/chat/a%2Fb");
  });

  it("turns a contract error into a typed failure", async () => {
    const api = createApiClient({
      fetch: respond(409, {
        error: {
          code: "conflict",
          message: "This conversation is waiting for a nurse to respond.",
        },
      }),
    });

    const failure = await api
      .sendMessage("tok", { message: "hi" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiClientError);
    expect(failure).toMatchObject({
      status: 409,
      code: "conflict",
      message: "This conversation is waiting for a nurse to respond.",
    });
    expect(isApiClientError(failure, "conflict")).toBe(true);
    expect(isApiClientError(failure, "forbidden")).toBe(false);
  });

  it("reports a non-contract error body as a generic failure", async () => {
    const api = createApiClient({ fetch: respond(502, "<html>Bad gateway</html>") });

    await expect(api.getThread("tok", THREAD)).rejects.toMatchObject({
      status: 502,
      code: "internal",
    });
  });

  it("rejects a success response that does not match the contract", async () => {
    const api = createApiClient({
      fetch: respond(200, { threadId: THREAD, status: "exploded", messages: [] }),
    });

    await expect(api.getThread("tok", THREAD)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects a success response with no JSON at all", async () => {
    const api = createApiClient({ fetch: vi.fn(async () => new Response("", { status: 200 })) });

    await expect(api.getThread("tok", THREAD)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("reports an unreachable server as a network error", async () => {
    const api = createApiClient({
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });

    await expect(api.getThread("tok", THREAD)).rejects.toMatchObject({
      status: 0,
      code: "network",
    });
  });

  it("never puts the request body into an error message", async () => {
    const api = createApiClient({
      fetch: respond(400, {
        error: { code: "validation_error", message: "Invalid request: message." },
      }),
    });

    const failure = await api
      .sendMessage("tok", { message: "Ada Quillfeather chest pain" })
      .catch((error: unknown) => error);

    expect(String(failure)).not.toContain("Quillfeather");
  });
});
