import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NURSE_APPROVED_RED_FLAG_TEXT } from "../src/graph/messages.js";
import { DEMO_ELEVATED_CONCERN, DEMO_ELEVATED_DRAFT, DEMO_TRIAGE_REPLY } from "../src/llm/demo.js";
import { LlmUnavailableError } from "../src/llm/port.js";
import { connectEhr, type EhrConnection } from "../src/mcp/ehr.js";
import { EMERGENCY_NOTICE } from "../src/safety/redFlags.js";
import { http, login, MOCK_EHR, startTestApp, type TestApp } from "./support/app.js";
import { failingLlm } from "./support/harness.js";

let ehr: EhrConnection;
let app: TestApp;

beforeAll(async () => {
  ehr = await connectEhr({ command: process.execPath, args: [MOCK_EHR] });
  app = await startTestApp({ ehr });
});

afterAll(async () => {
  await app.stop();
  await ehr.close();
});

/** Narrow an unknown JSON body without casts. */
function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null && key in body
    ? Reflect.get(body, key)
    : undefined;
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const chat = (token: string, message: string, threadId?: string) =>
  http(app, "POST", "/api/chat", { token, body: { message, ...(threadId ? { threadId } : {}) } });

describe("service basics", () => {
  it("answers the health check and adds request headers", async () => {
    const result = await http(app, "GET", "/api/health");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "ok" });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.headers.get("x-powered-by")).toBeNull();
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const result = await http(app, "GET", "/api/nope");

    expect(result.status).toBe(404);
    expect(field(field(result.body, "error"), "code")).toBe("not_found");
  });
});

describe("demo login", () => {
  it("signs a patient in and rejects unknown or missing patients", async () => {
    const ok = await http(app, "POST", "/api/auth/demo-login", {
      body: { role: "patient", patientId: "P-1002" },
    });
    expect(ok.status).toBe(200);
    expect(field(ok.body, "role")).toBe("patient");
    expect(field(ok.body, "patientId")).toBe("P-1002");
    expect(typeof field(ok.body, "token")).toBe("string");

    const unknown = await http(app, "POST", "/api/auth/demo-login", {
      body: { role: "patient", patientId: "P-9999" },
    });
    expect(unknown.status).toBe(400);
    const missing = await http(app, "POST", "/api/auth/demo-login", { body: { role: "patient" } });
    expect(missing.status).toBe(400);
  });

  it("signs a nurse in", async () => {
    const result = await http(app, "POST", "/api/auth/demo-login", { body: { role: "nurse" } });

    expect(result.status).toBe(200);
    expect(field(result.body, "role")).toBe("nurse");
    expect(field(result.body, "patientId")).toBeUndefined();
  });

  it("is switched off when disabled", async () => {
    const disabled = await startTestApp({ ehr, demoLoginEnabled: false });
    try {
      const result = await http(disabled, "POST", "/api/auth/demo-login", {
        body: { role: "nurse" },
      });
      expect(result.status).toBe(404);
    } finally {
      await disabled.stop();
    }
  });
});

describe("authentication and roles", () => {
  it("rejects missing, malformed and forged tokens", async () => {
    expect((await http(app, "POST", "/api/chat", { body: { message: "hi" } })).status).toBe(401);
    expect((await chat("not-a-token", "hi")).status).toBe(401);
    expect((await http(app, "GET", "/api/nurse/escalations", { token: "a.b.c" })).status).toBe(401);
  });

  it("keeps patients out of nurse endpoints and nurses out of the chat", async () => {
    const patient = await login(app, "patient", "P-1002");
    const nurse = await login(app, "nurse");

    expect((await http(app, "GET", "/api/nurse/escalations", { token: patient })).status).toBe(403);
    expect(
      (
        await http(
          app,
          "POST",
          "/api/nurse/escalations/6f1c1d3e-0a55-4b8d-9d1a-1f6f0c7d9a11/resolve",
          {
            token: patient,
            body: { decision: "approve" },
          },
        )
      ).status,
    ).toBe(403);
    expect((await chat(nurse, "hello")).status).toBe(403);
  });
});

describe("normal conversation", () => {
  it("answers a routine question using the signed-in patient's own history", async () => {
    const token = await login(app, "patient", "P-1002");

    const result = await chat(token, "I have had a mild cough for two days");

    expect(result.status).toBe(200);
    expect(field(result.body, "status")).toBe("responded");
    expect(field(result.body, "emergencyNotice")).toBeUndefined();
    expect(field(result.body, "messages")).toMatchObject([
      { role: "assistant", content: DEMO_TRIAGE_REPLY },
    ]);
    expect(field(result.body, "threadId")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("continues a thread and returns the whole transcript on GET", async () => {
    const token = await login(app, "patient", "P-1002");
    const first = await chat(token, "I have a mild cough");
    const threadId = String(field(first.body, "threadId"));

    await chat(token, "It is a bit worse today", threadId);
    const thread = await http(app, "GET", `/api/chat/${threadId}`, { token });

    expect(thread.status).toBe(200);
    expect(field(thread.body, "status")).toBe("responded");
    const roles = items(field(thread.body, "messages")).map((m) => field(m, "role"));
    expect(roles).toEqual(["patient", "assistant", "patient", "assistant"]);
  });

  it("books through the real MCP server, offering first and booking only after a yes", async () => {
    const token = await login(app, "patient", "P-1004");

    const offer = await chat(token, "I would like to book a neurology appointment");
    const threadId = String(field(offer.body, "threadId"));
    expect(JSON.stringify(field(offer.body, "messages"))).toContain("Shall I book it?");

    const booked = await chat(token, "Yes please", threadId);
    expect(JSON.stringify(field(booked.body, "messages"))).toMatch(
      /appointment is booked.*A-\d{4}/,
    );
  });
});

describe("red-flag escalation", () => {
  it("shows the emergency notice at once, holds the thread, and resumes when a nurse decides", async () => {
    const patient = await login(app, "patient", "P-1002");
    const nurse = await login(app, "nurse");

    const sent = await chat(patient, "I have chest pain and I feel dizzy");
    const threadId = String(field(sent.body, "threadId"));

    expect(sent.status).toBe(200);
    expect(field(sent.body, "status")).toBe("awaiting_nurse");
    expect(field(sent.body, "emergencyNotice")).toBe(EMERGENCY_NOTICE);
    expect(field(sent.body, "messages")).toMatchObject([
      { role: "system", content: EMERGENCY_NOTICE },
    ]);

    // The thread is held: more messages are refused until a nurse decides.
    const blocked = await chat(patient, "hello?", threadId);
    expect(blocked.status).toBe(409);
    const held = await http(app, "GET", `/api/chat/${threadId}`, { token: patient });
    expect(field(held.body, "status")).toBe("awaiting_nurse");

    // The nurse sees it in the queue, without any free text in the list view.
    const queue = await http(app, "GET", "/api/nurse/escalations?status=pending", { token: nurse });
    const entry = items(queue.body).find((e) => field(e, "threadId") === threadId);
    expect(entry).toBeDefined();
    expect(Object.keys(Object(entry)).sort()).toEqual([
      "categories",
      "createdAt",
      "patientId",
      "reason",
      "status",
      "threadId",
    ]);
    expect(entry).toMatchObject({
      patientId: "P-1002",
      reason: "red_flag",
      categories: ["chest_pain"],
      status: "pending",
    });

    // The detail view has the transcript.
    const detail = await http(app, "GET", `/api/nurse/escalations/${threadId}`, { token: nurse });
    expect(JSON.stringify(field(detail.body, "transcript"))).toContain("I have chest pain");

    const resolved = await http(app, "POST", `/api/nurse/escalations/${threadId}/resolve`, {
      token: nurse,
      body: { decision: "approve", note: "Called the patient." },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toEqual({ threadId, status: "resolved" });

    // The patient now sees the reply, and may continue the conversation.
    const after = await http(app, "GET", `/api/chat/${threadId}`, { token: patient });
    expect(field(after.body, "status")).toBe("responded");
    const contents = items(field(after.body, "messages")).map((m) => field(m, "content"));
    expect(contents.at(-1)).toBe(NURSE_APPROVED_RED_FLAG_TEXT);
    expect(contents).not.toContain("Called the patient.");
    const again = await chat(patient, "Thank you, I also have a mild cough", threadId);
    expect(again.status).toBe(200);
    expect(field(again.body, "status")).toBe("responded");

    // Resolving twice changes nothing.
    const twice = await http(app, "POST", `/api/nurse/escalations/${threadId}/resolve`, {
      token: nurse,
      body: { decision: "reject" },
    });
    expect(twice.status).toBe(409);
    const pending = await http(app, "GET", "/api/nurse/escalations?status=pending", {
      token: nurse,
    });
    expect(items(pending.body).some((e) => field(e, "threadId") === threadId)).toBe(false);
  });

  it("escalates a model-requested review for the patient with rising blood pressure and withholds the draft", async () => {
    // P-1001's history has a rising systolic trend in the mock EHR, so this only works if the
    // signed-in patient's ID reached the EHR through the hook.
    const patient = await login(app, "patient", "P-1001");
    const nurse = await login(app, "nurse");

    const sent = await chat(patient, "I feel dizzy and have a headache");
    const threadId = String(field(sent.body, "threadId"));

    expect(field(sent.body, "status")).toBe("awaiting_nurse");
    expect(field(sent.body, "emergencyNotice")).toBeUndefined();
    expect(JSON.stringify(field(sent.body, "messages"))).not.toContain(DEMO_ELEVATED_DRAFT);

    const detail = await http(app, "GET", `/api/nurse/escalations/${threadId}`, { token: nurse });
    expect(detail.body).toMatchObject({
      reason: "high_risk_output",
      concern: DEMO_ELEVATED_CONCERN,
      proposedReply: DEMO_ELEVATED_DRAFT,
    });

    const missingText = await http(app, "POST", `/api/nurse/escalations/${threadId}/resolve`, {
      token: nurse,
      body: { decision: "edit" },
    });
    expect(missingText.status).toBe(400);

    await http(app, "POST", `/api/nurse/escalations/${threadId}/resolve`, {
      token: nurse,
      body: { decision: "edit", editedReply: "Please book a blood pressure check today." },
    });
    const after = await http(app, "GET", `/api/chat/${threadId}`, { token: patient });
    const contents = items(field(after.body, "messages")).map((m) => field(m, "content"));
    expect(contents.at(-1)).toBe("Please book a blood pressure check today.");
  });
});

describe("conversation ownership", () => {
  it("hides other patients' conversations as not found", async () => {
    const owner = await login(app, "patient", "P-1002");
    const other = await login(app, "patient", "P-1003");
    const sent = await chat(owner, "I have a mild cough");
    const threadId = String(field(sent.body, "threadId"));

    expect((await http(app, "GET", `/api/chat/${threadId}`, { token: other })).status).toBe(404);
    expect((await chat(other, "hello", threadId)).status).toBe(404);
    expect((await http(app, "GET", "/api/chat/not-a-uuid", { token: owner })).status).toBe(404);
    expect(
      (await http(app, "GET", "/api/chat/6f1c1d3e-0a55-4b8d-9d1a-1f6f0c7d9a11", { token: owner }))
        .status,
    ).toBe(404);
  });

  it("returns 404 for an unknown escalation", async () => {
    const nurse = await login(app, "nurse");

    const result = await http(
      app,
      "GET",
      "/api/nurse/escalations/6f1c1d3e-0a55-4b8d-9d1a-1f6f0c7d9a11",
      { token: nurse },
    );

    expect(result.status).toBe(404);
  });
});

describe("input validation", () => {
  it("rejects bad chat requests with fixed messages that never echo the input", async () => {
    const token = await login(app, "patient", "P-1002");
    const canary = "Ada Quillfeather 1971-03-14";

    const empty = await chat(token, "   ");
    const tooLong = await chat(token, `${canary} ${"x".repeat(2100)}`);
    const extra = await http(app, "POST", "/api/chat", {
      token,
      body: { message: "hi", surprise: canary },
    });
    const badJson = await http(app, "POST", "/api/chat", {
      token,
      rawBody: `{"message": "${canary}`,
    });
    const huge = await http(app, "POST", "/api/chat", {
      token,
      rawBody: JSON.stringify({ message: "x".repeat(20_000) }),
    });

    for (const result of [empty, tooLong, extra, badJson, huge]) {
      expect(result.status).toBe(400);
      expect(field(field(result.body, "error"), "code")).toBe("validation_error");
      expect(JSON.stringify(result.body)).not.toContain("Quillfeather");
    }
    expect(field(field(empty.body, "error"), "message")).toBe("Invalid request: message.");
  });

  it("rejects a malformed thread ID and a bad status filter", async () => {
    const nurse = await login(app, "nurse");

    expect(
      (await http(app, "GET", "/api/nurse/escalations?status=bogus", { token: nurse })).status,
    ).toBe(400);
    expect(
      (
        await http(app, "POST", "/api/nurse/escalations/not-a-uuid/resolve", {
          token: nurse,
          body: { decision: "approve" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("when the model is down", () => {
  it("returns 503 for a normal message but still escalates a red flag", async () => {
    const down = await startTestApp({ ehr, llm: failingLlm(new LlmUnavailableError("down")) });
    try {
      const token = await login(down, "patient", "P-1002");

      const normal = await http(down, "POST", "/api/chat", {
        token,
        body: { message: "I have a mild cough" },
      });
      expect(normal.status).toBe(503);
      expect(field(field(normal.body, "error"), "code")).toBe("llm_unavailable");

      const urgent = await http(down, "POST", "/api/chat", {
        token,
        body: { message: "I can't breathe" },
      });
      expect(urgent.status).toBe(200);
      expect(field(urgent.body, "status")).toBe("awaiting_nurse");
      expect(field(urgent.body, "emergencyNotice")).toBe(EMERGENCY_NOTICE);
    } finally {
      await down.stop();
    }
  });
});

describe("privacy", () => {
  it("never writes patient text, names, dates of birth or tokens to the logs", async () => {
    const canaries = ["Quillfeather", "1971-03-14", "chest pain", "Ada", "shortness"];
    const patient = await login(app, "patient", "P-1002");
    const nurse = await login(app, "nurse");

    const sent = await chat(
      patient,
      "My name is Ada Quillfeather, born 1971-03-14. I have chest pain and shortness of breath.",
    );
    const threadId = String(field(sent.body, "threadId"));
    await http(app, "POST", `/api/nurse/escalations/${threadId}/resolve`, {
      token: nurse,
      body: { decision: "approve", note: "Ada Quillfeather was phoned about chest pain." },
    });
    await chat(patient, "   "); // a rejected request, to exercise the error path

    const output = app.logs.join("\n");
    for (const canary of canaries) {
      expect(output).not.toContain(canary);
    }
    expect(output).not.toContain(patient);
    expect(output).not.toContain(nurse);
    expect(output).toContain('"event":"escalation_opened"');
    expect(output).toContain('"event":"escalation_resolved"');
    expect(output).toContain('"route":"/api/chat"');
  });
});
