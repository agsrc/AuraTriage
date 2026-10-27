import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  deferred,
  failure,
  fakeApi,
  message,
  NOTICE_TEXT,
  renderApp,
  storeSession,
} from "./support/fixtures";

const THREAD = "11111111-1111-4111-8111-111111111111";
const box = () => screen.getByRole("textbox", { name: "Message" });

describe("patient sign-in", () => {
  it("signs a demo patient in and shows the empty chat", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      demoLogin: vi.fn().mockResolvedValue({ token: "t", role: "patient", patientId: "P-1001" }),
    });
    renderApp(api);

    expect(screen.getByRole("heading", { name: "Welcome to AuraTriage" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Patient P-1003" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "How can I help today?" }),
    ).toBeInTheDocument();
    expect(api.demoLogin).toHaveBeenCalledWith({ role: "patient", patientId: "P-1003" });
    expect(screen.getByText("Patient P-1001")).toBeInTheDocument();
  });

  it("shows why sign-in failed", async () => {
    const user = userEvent.setup();
    renderApp(fakeApi({ demoLogin: vi.fn().mockRejectedValue(failure(0, "network")) }));

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });

  it("does not link to the nurse dashboard", () => {
    renderApp(fakeApi());

    expect(screen.queryByRole("link", { name: /nurse/i })).not.toBeInTheDocument();
  });
});

describe("chatting", () => {
  it("sends a message and shows the reply", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    const reply = deferred<Awaited<ReturnType<ReturnType<typeof fakeApi>["sendMessage"]>>>();
    const api = fakeApi({ sendMessage: vi.fn().mockReturnValue(reply.promise) });
    renderApp(api);

    await user.type(box(), "I have a mild cough{Enter}");

    expect(api.sendMessage).toHaveBeenCalledWith("test-token", {
      threadId: undefined,
      message: "I have a mild cough",
    });
    expect(await screen.findByText("I have a mild cough")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "The assistant is typing" })).toBeInTheDocument();
    expect(box()).toBeDisabled();

    reply.resolve({
      threadId: THREAD,
      status: "responded",
      messages: [message({ role: "assistant", content: "That does not sound urgent." })],
    });

    expect(await screen.findByText("That does not sound urgent.")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "The assistant is typing" }),
    ).not.toBeInTheDocument();
    expect(box()).toBeEnabled();
    expect(window.sessionStorage.getItem("aura.thread")).toBe(THREAD);
  });

  it("continues the same thread on the next message", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    const api = fakeApi({
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          threadId: THREAD,
          status: "responded",
          messages: [message({ role: "assistant", content: "One" })],
        })
        .mockResolvedValueOnce({
          threadId: THREAD,
          status: "responded",
          messages: [message({ role: "assistant", content: "Two" })],
        }),
    });
    renderApp(api);

    await user.type(box(), "first{Enter}");
    await screen.findByText("One");
    await user.type(box(), "second{Enter}");
    await screen.findByText("Two");

    expect(api.sendMessage).toHaveBeenLastCalledWith("test-token", {
      threadId: THREAD,
      message: "second",
    });
  });

  it("sends with Enter, adds a line with Shift+Enter, and ignores empty input", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    const api = fakeApi({
      sendMessage: vi
        .fn()
        .mockResolvedValue({ threadId: THREAD, status: "responded", messages: [] }),
    });
    renderApp(api);

    await user.type(box(), "{Enter}");
    await user.type(box(), "   {Enter}");
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await user.type(box(), "hello{Shift>}{Enter}{/Shift}world");
    expect(api.sendMessage).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
    expect(api.sendMessage).toHaveBeenCalledWith("test-token", {
      threadId: undefined,
      message: "hello\nworld",
    });
  });

  it("sends a demo example with one click", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    const api = fakeApi({
      sendMessage: vi
        .fn()
        .mockResolvedValue({ threadId: THREAD, status: "responded", messages: [] }),
    });
    renderApp(api);

    await user.click(screen.getByRole("button", { name: "I have a mild cough and a sore throat" }));

    expect(api.sendMessage).toHaveBeenCalledWith("test-token", {
      threadId: undefined,
      message: "I have a mild cough and a sore throat",
    });
  });

  it("starts a new conversation on request", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    const api = fakeApi({
      sendMessage: vi.fn().mockResolvedValue({
        threadId: THREAD,
        status: "responded",
        messages: [message({ role: "assistant", content: "Hello" })],
      }),
    });
    renderApp(api);
    await user.type(box(), "hi{Enter}");
    await screen.findByText("Hello");

    await user.click(screen.getByRole("button", { name: "Start a new conversation" }));

    expect(
      await screen.findByRole("heading", { name: "How can I help today?" }),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem("aura.thread")).toBeNull();
  });
});

describe("escalation", () => {
  it("shows the emergency notice at once, holds the chat, and resumes when the nurse replies", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    const api = fakeApi({
      sendMessage: vi.fn().mockResolvedValue({
        threadId: THREAD,
        status: "awaiting_nurse",
        emergencyNotice: NOTICE_TEXT,
        messages: [message({ role: "system", content: NOTICE_TEXT })],
      }),
      getThread: vi
        .fn()
        .mockResolvedValueOnce({ threadId: THREAD, status: "awaiting_nurse", messages: [] })
        .mockResolvedValue({
          threadId: THREAD,
          status: "responded",
          messages: [
            message({ role: "patient", content: "I have chest pain" }),
            message({ role: "system", content: NOTICE_TEXT }),
            message({ role: "assistant", content: "A nurse has reviewed your message." }),
          ],
        }),
    });
    renderApp(api);

    await user.type(box(), "I have chest pain{Enter}");

    expect(await screen.findByText("Medical emergency? Call 911 now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call 911" })).toHaveAttribute("href", "tel:911");
    expect(screen.getByRole("alert")).toHaveTextContent(NOTICE_TEXT);
    expect(screen.getByText("A nurse is reviewing your message.")).toBeInTheDocument();
    expect(box()).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Start a new conversation" }),
    ).not.toBeInTheDocument();

    expect(await screen.findByText("A nurse has reviewed your message.")).toBeInTheDocument();
    expect(screen.queryByText("A nurse is reviewing your message.")).not.toBeInTheDocument();
    expect(box()).toBeEnabled();
    expect(screen.getByText("Medical emergency? Call 911 now.")).toBeInTheDocument();
  });

  it("restores a held conversation after a reload and keeps waiting", async () => {
    storeSession("patient", "P-1002");
    window.sessionStorage.setItem("aura.thread", THREAD);
    const api = fakeApi({
      getThread: vi.fn().mockResolvedValue({
        threadId: THREAD,
        status: "awaiting_nurse",
        messages: [
          message({ role: "patient", content: "chest pain" }),
          message({ role: "system", content: NOTICE_TEXT }),
        ],
      }),
    });
    renderApp(api);

    expect(await screen.findByText("A nurse is reviewing your message.")).toBeInTheDocument();
    expect(screen.getByText("chest pain")).toBeInTheDocument();
    expect(box()).toBeDisabled();
  });

  it("learns the chat is held when the server answers 409", async () => {
    storeSession("patient", "P-1002");
    window.sessionStorage.setItem("aura.thread", THREAD);
    const user = userEvent.setup();
    const api = fakeApi({
      getThread: vi
        .fn()
        .mockResolvedValueOnce({ threadId: THREAD, status: "responded", messages: [] })
        .mockResolvedValue({
          threadId: THREAD,
          status: "awaiting_nurse",
          messages: [message({ role: "system", content: NOTICE_TEXT })],
        }),
      sendMessage: vi
        .fn()
        .mockRejectedValue(
          failure(409, "conflict", "This conversation is waiting for a nurse to respond."),
        ),
    });
    renderApp(api);
    await waitFor(() => expect(box()).toBeEnabled());

    await user.type(box(), "hello?{Enter}");

    expect(await screen.findByText("A nurse is reviewing your message.")).toBeInTheDocument();
  });
});

describe("restoring and errors", () => {
  it("restores a saved conversation", async () => {
    storeSession("patient", "P-1002");
    window.sessionStorage.setItem("aura.thread", THREAD);
    const api = fakeApi({
      getThread: vi.fn().mockResolvedValue({
        threadId: THREAD,
        status: "responded",
        messages: [
          message({ role: "patient", content: "earlier question" }),
          message({ role: "assistant", content: "earlier answer" }),
        ],
      }),
    });
    renderApp(api);

    expect(await screen.findByText("earlier answer")).toBeInTheDocument();
    expect(api.getThread).toHaveBeenCalledWith("test-token", THREAD);
  });

  it("forgets a saved conversation the server no longer knows", async () => {
    storeSession("patient", "P-1002");
    window.sessionStorage.setItem("aura.thread", THREAD);
    renderApp(fakeApi({ getThread: vi.fn().mockRejectedValue(failure(404, "not_found")) }));

    expect(
      await screen.findByRole("heading", { name: "How can I help today?" }),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem("aura.thread")).toBeNull();
  });

  it("explains when the assistant is unavailable and lets the patient try again", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    const api = fakeApi({
      sendMessage: vi.fn().mockRejectedValue(failure(503, "llm_unavailable")),
    });
    renderApp(api);

    await user.type(box(), "hello{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The assistant is unavailable right now",
    );
    expect(box()).toBeEnabled();
  });

  it("returns to sign-in when the session has expired", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    renderApp(fakeApi({ sendMessage: vi.fn().mockRejectedValue(failure(401, "unauthorized")) }));

    await user.type(box(), "hello{Enter}");

    expect(
      await screen.findByRole("heading", { name: "Welcome to AuraTriage" }),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem("aura.session")).toBeNull();
  });

  it("signs out", async () => {
    storeSession("patient", "P-1002");
    const user = userEvent.setup();
    renderApp(fakeApi());

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("heading", { name: "Welcome to AuraTriage" }),
    ).toBeInTheDocument();
  });
});
