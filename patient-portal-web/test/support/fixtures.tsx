import type { ChatMessage, EscalationDetail, EscalationSummary } from "@contracts";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { App } from "../../src/App";
import { type ApiClient, ApiClientError } from "../../src/api/client";
import { AppProviders } from "../../src/app/context";

export const NOTICE_TEXT =
  "If you think this may be a medical emergency, call 911. A nurse has been alerted.";

export function message(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, "role" | "content">,
): ChatMessage {
  return { id: `m-${overrides.content}`, createdAt: "2026-10-27T12:00:00.000Z", ...overrides };
}

export function summary(overrides: Partial<EscalationSummary> = {}): EscalationSummary {
  return {
    threadId: "11111111-1111-4111-8111-111111111111",
    patientId: "P-1002",
    reason: "red_flag",
    categories: ["chest_pain"],
    status: "pending",
    createdAt: "2026-10-27T12:00:00.000Z",
    ...overrides,
  };
}

export function detail(overrides: Partial<EscalationDetail> = {}): EscalationDetail {
  return {
    ...summary(),
    transcript: [
      message({ role: "patient", content: "I have chest pain" }),
      message({ role: "system", content: NOTICE_TEXT }),
    ],
    ...overrides,
  };
}

/** A client whose every method fails the test unless it was given an implementation. */
export function fakeApi(overrides: Partial<ApiClient> = {}) {
  const unexpected = (name: string) =>
    vi.fn(() => Promise.reject(new Error(`Unexpected call to ${name}`)));
  const api = {
    demoLogin: unexpected("demoLogin"),
    sendMessage: unexpected("sendMessage"),
    getThread: unexpected("getThread"),
    listEscalations: unexpected("listEscalations"),
    getEscalation: unexpected("getEscalation"),
    resolveEscalation: unexpected("resolveEscalation"),
    ...overrides,
  };
  return api satisfies ApiClient;
}

export const failure = (status: number, code: ApiClientError["code"], text = "Failure.") =>
  new ApiClientError(status, code, text);

export function storeSession(role: "patient" | "nurse", patientId?: string) {
  window.sessionStorage.setItem(
    "aura.session",
    JSON.stringify({ token: "test-token", role, patientId }),
  );
}

export function renderApp(api: ApiClient, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders
        api={api}
        storage={window.sessionStorage}
        timing={{ patientPollMs: 20, queuePollMs: 20 }}
      >
        <App />
      </AppProviders>
    </MemoryRouter>,
  );
}

/** A promise you resolve by hand, to look at the UI while a request is in flight. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
