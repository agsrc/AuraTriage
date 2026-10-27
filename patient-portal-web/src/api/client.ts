import {
  ApiErrorSchema,
  type ChatRequest,
  type ChatResponse,
  ChatResponseSchema,
  type DemoLoginRequest,
  type DemoLoginResponse,
  DemoLoginResponseSchema,
  type ErrorCode,
  type EscalationDetail,
  EscalationDetailSchema,
  type EscalationStatus,
  type EscalationSummary,
  EscalationSummarySchema,
  type NurseResolution,
  type ResolveResponse,
  ResolveResponseSchema,
  type ThreadResponse,
  ThreadResponseSchema,
} from "@contracts";
import { z } from "zod";

export type ClientErrorCode = ErrorCode | "network" | "invalid_response";

/** Every failure the UI has to handle. Messages are safe to show: they never contain patient text. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;

  constructor(status: number, code: ClientErrorCode, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

export interface ApiClient {
  demoLogin(request: DemoLoginRequest): Promise<DemoLoginResponse>;
  sendMessage(token: string, request: ChatRequest): Promise<ChatResponse>;
  getThread(token: string, threadId: string): Promise<ThreadResponse>;
  listEscalations(token: string, status?: EscalationStatus): Promise<EscalationSummary[]>;
  getEscalation(token: string, threadId: string): Promise<EscalationDetail>;
  resolveEscalation(
    token: string,
    threadId: string,
    resolution: NurseResolution,
  ): Promise<ResolveResponse>;
}

export interface ApiClientOptions {
  /** Empty means same origin, which is what the Vite proxy and a production reverse proxy want. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const base = (options.baseUrl ?? "").replace(/\/+$/, "");
  const doFetch: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  /** One request, one schema. The response is parsed, never trusted. */
  async function request<S extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    schema: S,
    options: { token?: string; body?: unknown } = {},
  ): Promise<z.output<S>> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiClientError(0, "network", "Could not reach the server.");
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }

    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(json);
      throw parsed.success
        ? new ApiClientError(response.status, parsed.data.error.code, parsed.data.error.message)
        : new ApiClientError(
            response.status,
            "internal",
            "The server returned an unexpected error.",
          );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiClientError(
        response.status,
        "invalid_response",
        "The server sent a response we could not read.",
      );
    }
    return parsed.data;
  }

  const threadPath = (threadId: string) => `/api/chat/${encodeURIComponent(threadId)}`;
  const escalationPath = (threadId: string) =>
    `/api/nurse/escalations/${encodeURIComponent(threadId)}`;

  return {
    demoLogin: (body) => request("POST", "/api/auth/demo-login", DemoLoginResponseSchema, { body }),
    sendMessage: (token, body) => request("POST", "/api/chat", ChatResponseSchema, { token, body }),
    getThread: (token, threadId) =>
      request("GET", threadPath(threadId), ThreadResponseSchema, { token }),
    listEscalations: (token, status) =>
      request(
        "GET",
        `/api/nurse/escalations${status === undefined ? "" : `?status=${status}`}`,
        z.array(EscalationSummarySchema),
        { token },
      ),
    getEscalation: (token, threadId) =>
      request("GET", escalationPath(threadId), EscalationDetailSchema, { token }),
    resolveEscalation: (token, threadId, body) =>
      request("POST", `${escalationPath(threadId)}/resolve`, ResolveResponseSchema, {
        token,
        body,
      }),
  };
}

export function isApiClientError(error: unknown, code?: ClientErrorCode): error is ApiClientError {
  return error instanceof ApiClientError && (code === undefined || error.code === code);
}
