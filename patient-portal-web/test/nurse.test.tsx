import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  detail,
  failure,
  fakeApi,
  message,
  NOTICE_TEXT,
  renderApp,
  storeSession,
  summary,
} from "./support/fixtures";

const THREAD = "11111111-1111-4111-8111-111111111111";

function nurseApi(overrides: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    listEscalations: vi.fn().mockResolvedValue([summary()]),
    getEscalation: vi.fn().mockResolvedValue(detail()),
    resolveEscalation: vi.fn().mockResolvedValue({ threadId: THREAD, status: "resolved" }),
    ...overrides,
  });
}

async function openFirstEscalation() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Patient P-1002/ }));
  await screen.findByRole("heading", { name: "Patient P-1002" });
  return user;
}

describe("nurse sign-in and access", () => {
  it("asks for a nurse sign-in and then opens the queue", async () => {
    const user = userEvent.setup();
    const api = nurseApi({ demoLogin: vi.fn().mockResolvedValue({ token: "n", role: "nurse" }) });
    renderApp(api, "/nurse");

    await user.click(screen.getByRole("button", { name: "Sign in as demo nurse" }));

    expect(api.demoLogin).toHaveBeenCalledWith({ role: "nurse" });
    expect(await screen.findByRole("tab", { name: "Waiting (1)" })).toBeInTheDocument();
  });

  it("does not show the dashboard to a signed-in patient", () => {
    storeSession("patient", "P-1002");
    renderApp(nurseApi(), "/nurse");

    expect(screen.getByRole("button", { name: "Sign in as demo nurse" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("signs out when the session has expired", async () => {
    storeSession("nurse");
    renderApp(
      nurseApi({ listEscalations: vi.fn().mockRejectedValue(failure(401, "unauthorized")) }),
      "/nurse",
    );

    expect(
      await screen.findByRole("button", { name: "Sign in as demo nurse" }),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem("aura.session")).toBeNull();
  });
});

describe("queue", () => {
  it("lists waiting escalations with reason and categories, and no message text", async () => {
    storeSession("nurse");
    renderApp(nurseApi(), "/nurse");

    const item = await screen.findByRole("button", { name: /Patient P-1002/ });

    expect(within(item).getByText("Red flag")).toBeInTheDocument();
    expect(within(item).getByText("Chest pain")).toBeInTheDocument();
    expect(screen.queryByText("I have chest pain")).not.toBeInTheDocument();
  });

  it("picks up new escalations without a reload", async () => {
    storeSession("nurse");
    const api = nurseApi({
      listEscalations: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue([summary({ patientId: "P-1004" })]),
    });
    renderApp(api, "/nurse");

    expect(await screen.findByText("Nothing is waiting for a nurse.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Patient P-1004/ })).toBeInTheDocument();
  });

  it("shows resolved escalations on their own tab, read-only", async () => {
    storeSession("nurse");
    const user = userEvent.setup();
    const resolved = summary({ status: "resolved" });
    const api = nurseApi({
      listEscalations: vi.fn((_token: string, status?: string) =>
        Promise.resolve(status === "resolved" ? [resolved] : []),
      ),
      getEscalation: vi.fn().mockResolvedValue(detail({ status: "resolved" })),
    });
    renderApp(api, "/nurse");

    await user.click(await screen.findByRole("tab", { name: "Resolved" }));
    await user.click(await screen.findByRole("button", { name: /Patient P-1002/ }));

    expect(
      await screen.findByText(
        "This escalation is resolved. The patient's conversation has continued.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume conversation" })).not.toBeInTheDocument();
  });

  it("explains a queue that cannot be loaded", async () => {
    storeSession("nurse");
    renderApp(
      nurseApi({ listEscalations: vi.fn().mockRejectedValue(failure(0, "network")) }),
      "/nurse",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});

describe("detail", () => {
  it("shows why a red flag fired and the conversation, with the emergency notice labelled", async () => {
    storeSession("nurse");
    renderApp(nurseApi(), "/nurse");

    await openFirstEscalation();

    expect(screen.getByText(/matched an automatic red-flag pattern/)).toBeInTheDocument();
    expect(screen.getByText("I have chest pain")).toBeInTheDocument();
    expect(screen.getByText("Emergency notice shown to the patient")).toBeInTheDocument();
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument();
  });

  it("shows the assistant's concern and withheld draft for a model-requested review", async () => {
    storeSession("nurse");
    const api = nurseApi({
      listEscalations: vi
        .fn()
        .mockResolvedValue([summary({ reason: "high_risk_output", categories: [] })]),
      getEscalation: vi.fn().mockResolvedValue(
        detail({
          reason: "high_risk_output",
          categories: [],
          concern: "Rising blood pressure trend.",
          proposedReply: "Please book a blood pressure check.",
          transcript: [message({ role: "patient", content: "I feel dizzy" })],
        }),
      ),
    });
    renderApp(api, "/nurse");

    await openFirstEscalation();

    expect(screen.getByText(/Rising blood pressure trend\./)).toBeInTheDocument();
    expect(screen.getByText("Please book a blood pressure check.")).toBeInTheDocument();
    expect(screen.getByText(/withheld until you decide/)).toBeInTheDocument();
    expect(
      screen.getByText(/Send the assistant's reply to the patient as written/),
    ).toBeInTheDocument();
  });

  it("shows nurse notes in the transcript", async () => {
    storeSession("nurse");
    const api = nurseApi({
      getEscalation: vi.fn().mockResolvedValue(
        detail({
          transcript: [message({ role: "nurse", content: "Phoned the patient." })],
          status: "resolved",
        }),
      ),
    });
    renderApp(api, "/nurse");

    await openFirstEscalation();

    expect(screen.getByText("Nurse note")).toBeInTheDocument();
    expect(screen.getByText("Phoned the patient.")).toBeInTheDocument();
  });
});

describe("resolving", () => {
  it("approves with a note and confirms the conversation resumed", async () => {
    storeSession("nurse");
    const list = vi.fn().mockResolvedValue([summary()]);
    const api = nurseApi({ listEscalations: list });
    renderApp(api, "/nurse");
    const user = await openFirstEscalation();
    const loadsBefore = list.mock.calls.length;

    await user.type(screen.getByRole("textbox", { name: /Internal note/ }), "Called the patient.");
    await user.click(screen.getByRole("button", { name: "Resume conversation" }));

    expect(api.resolveEscalation).toHaveBeenCalledWith("test-token", THREAD, {
      decision: "approve",
      note: "Called the patient.",
    });
    expect(
      await screen.findByText("Conversation resumed. The patient will see the reply shortly."),
    ).toBeInTheDocument();
    // The queue is reloaded right after a decision.
    expect(list.mock.calls.length).toBeGreaterThan(loadsBefore);
  });

  it("will not send an edit without a reply, then sends it", async () => {
    storeSession("nurse");
    const api = nurseApi();
    renderApp(api, "/nurse");
    const user = await openFirstEscalation();

    await user.click(screen.getByRole("radio", { name: /Edit and send/ }));
    expect(screen.getByRole("button", { name: "Resume conversation" })).toBeDisabled();

    await user.type(
      screen.getByRole("textbox", { name: "Reply to the patient" }),
      "  Please come in today.  ",
    );
    await user.click(screen.getByRole("button", { name: "Resume conversation" }));

    expect(api.resolveEscalation).toHaveBeenCalledWith("test-token", THREAD, {
      decision: "edit",
      editedReply: "Please come in today.",
    });
  });

  it("rejects", async () => {
    storeSession("nurse");
    const api = nurseApi();
    renderApp(api, "/nurse");
    const user = await openFirstEscalation();

    await user.click(screen.getByRole("radio", { name: /Reject/ }));
    await user.click(screen.getByRole("button", { name: "Resume conversation" }));

    expect(api.resolveEscalation).toHaveBeenCalledWith("test-token", THREAD, {
      decision: "reject",
    });
  });

  it("says so when someone else already resolved it", async () => {
    storeSession("nurse");
    const api = nurseApi({
      resolveEscalation: vi
        .fn()
        .mockRejectedValue(failure(409, "conflict", "This escalation has already been resolved.")),
    });
    renderApp(api, "/nurse");
    const user = await openFirstEscalation();

    await user.click(screen.getByRole("button", { name: "Resume conversation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already resolved");
  });

  it("disables the form while the decision is being sent", async () => {
    storeSession("nurse");
    const resolved = { threadId: THREAD, status: "resolved" } as const;
    let finish: () => void = () => undefined;
    const api = nurseApi({
      resolveEscalation: vi.fn(
        () =>
          new Promise<typeof resolved>((resolve) => {
            finish = () => resolve(resolved);
          }),
      ),
    });
    renderApp(api, "/nurse");
    const user = await openFirstEscalation();

    await user.click(screen.getByRole("button", { name: "Resume conversation" }));

    expect(await screen.findByRole("button", { name: "Resuming…" })).toBeDisabled();
    finish();
    expect(await screen.findByText(/Conversation resumed/)).toBeInTheDocument();
  });
});
