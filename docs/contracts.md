# Contracts

Single source of truth for the HTTP API (orchestrator <-> web) and the MCP tools (orchestrator <-> Java server). Change this file in the same commit as the code.

The shapes below are Zod schemas in `agent-orchestrator/src/contracts.ts`. The web portal imports them as `@contracts` and parses every response with them, so if this page and the schemas ever disagree, the schemas win and this page is the bug.

Conventions: JSON, UTF-8, ISO-8601 UTC timestamps, IDs are opaque strings. `patientId` matches `^P-\d{4}$`, `slotId` matches `^S-\d{4}$`.

## Auth

`POST /api/auth/demo-login` (no auth). Demo only: issues a signed JWT (HS256, `jose`) for a seeded identity.

```ts
interface DemoLoginRequest {
  role: "patient" | "nurse";
  patientId?: string;
} // patientId required when role = "patient"
interface DemoLoginResponse {
  token: string;
  role: "patient" | "nurse";
  patientId?: string;
}
```

All other endpoints need `Authorization: Bearer <token>`. The token carries `role` and, for patients, `patientId`, and lasts 8 hours. A patient ID that is not in `DEMO_PATIENT_IDS` (default `P-1001` to `P-1005`) is refused with `400`. The endpoint answers `404` when `ENABLE_DEMO_LOGIN` is off, and production configuration refuses to start with it on.

`GET /api/health` (no auth) returns `{ "status": "ok" }`.

## Patient chat

`POST /api/chat` (role: patient)

```ts
interface ChatRequest {
  threadId?: string;
  message: string;
} // 1..2000 chars; omit threadId to start a conversation
interface ChatMessage {
  id: string;
  role: "patient" | "assistant" | "nurse" | "system";
  content: string;
  createdAt: string;
}
interface ChatResponse {
  threadId: string;
  status: "responded" | "awaiting_nurse";
  messages: ChatMessage[]; // assistant and system messages from this turn, not the patient's own
  emergencyNotice?: string; // static text, shown immediately when a red flag fired
}
```

`GET /api/chat/:threadId` (role: patient). Returns the thread for the polling UI.

```ts
interface ThreadResponse {
  threadId: string;
  status: "responded" | "awaiting_nurse";
  messages: ChatMessage[];
}
```

A patient can read only their own threads. Another patient's thread returns `404`, not `403`, so thread IDs cannot be probed.

Posting to a thread that is waiting for a nurse returns `409`, as does posting while the same thread is still handling a request. Once a nurse resolves the escalation, the same thread carries on. When the status is `awaiting_nurse` the portal polls `GET /api/chat/:threadId` until it becomes `responded`.

A message in `messages` with role `system` is the static emergency notice. It is part of the thread, so it is still there after a reload.

## Nurse escalations

All endpoints need role: nurse.

```ts
type RedFlagCategory =
  | "chest_pain"
  | "stroke_signs"
  | "breathing_difficulty"
  | "severe_bleeding"
  | "suicidal_ideation"
  | "anaphylaxis"
  | "loss_of_consciousness";

interface EscalationSummary {
  // list view: no free text
  threadId: string;
  patientId: string;
  reason: "red_flag" | "high_risk_output";
  categories: RedFlagCategory[];
  status: "pending" | "resolved";
  createdAt: string;
}
interface EscalationDetail extends EscalationSummary {
  transcript: ChatMessage[]; // free text lives here, behind the nurse role; includes nurse notes
  concern?: string; // pending high_risk_output only: why the assistant asked for review
  proposedReply?: string; // pending high_risk_output only: what the assistant would send if approved
}
```

- `GET /api/nurse/escalations?status=pending|resolved` returns `EscalationSummary[]`.
- `GET /api/nurse/escalations/:threadId` returns `EscalationDetail`.
- `POST /api/nurse/escalations/:threadId/resolve` resumes the paused graph.

```ts
interface ResolveRequest {
  decision: "approve" | "edit" | "reject";
  note?: string;
  editedReply?: string; // required when decision = "edit"
}
interface ResolveResponse {
  threadId: string;
  status: "resolved";
}
```

Resolving is idempotent: a second resolve of the same thread returns `409` and changes nothing.

What the patient receives after a decision:

| Decision  | Patient sees                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approve` | The assistant's own draft (`proposedReply`) when there is one, otherwise fixed text. Red flags: "A nurse has reviewed your message and will follow up..." |
| `edit`    | `editedReply`, exactly as the nurse wrote it                                                                                                              |
| `reject`  | Fixed text: a nurse reviewed it and the care team will contact the patient                                                                                |

`note` is internal. It appears in the nurse transcript with role `nurse` and is never shown to the patient or sent to the model. The queue lists pending items oldest first and resolved items newest first. A thread can be escalated again later, so the same `threadId` may appear more than once in the resolved list.

## Errors

```ts
interface ApiError {
  error: { code: ErrorCode; message: string };
}
type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "llm_unavailable"
  | "internal";
```

`401 unauthorized`, `403 forbidden`, `404 not_found`, `400 validation_error`, `409 conflict`, `503 llm_unavailable`, `500 internal`. Messages are fixed text and never echo anything the caller sent. A validation error lists the failing field names only, for example `Invalid request: message.` Unreadable JSON and bodies over 16 KB are also `400`.

`503 llm_unavailable` is returned only for a normal message when the model cannot be reached. A red flag never depends on the model, so it still returns `200` with `awaiting_nurse`.

## MCP tools (Java server, stdio)

Wire names are snake_case. The adapter prefixes them with the server name, so the orchestrator sees `ehr_get_patient_history`, `ehr_check_provider_availability`, `ehr_book_appointment`.

### `get_patient_history` (read-only)

Input: `patientId: string`. The orchestrator overwrites this from the session.

```ts
interface PatientHistorySummary {
  patientId: string;
  ageBand: string; // e.g. "40-49"; no DOB
  conditions: string[];
  medications: string[];
  allergies: string[];
  recentEncounters: { date: string; type: string; summary: string }[]; // at most 5
  episodesOfCare: { label: string; start: string; end: string; encounterCount: number }[];
  vitalsTrends: {
    metric: "systolic_bp" | "heart_rate";
    direction: "rising" | "falling" | "stable";
    windowSize: number;
  }[];
}
```
No name, DOB, address, phone or email is ever returned.

### `check_provider_availability` (read-only)

Input: `specialty: string`.

```ts
interface AvailabilityResult {
  specialty: string;
  slots: {
    slotId: string;
    providerId: string;
    providerName: string;
    start: string;
    durationMinutes: number;
  }[]; // at most 10
}
```

### `book_appointment` (mutating)

Input: `patientId: string` (overwritten from the session), `slotId: string`. The booking agent calls it only after the patient explicitly confirms.

```ts
interface BookingResult {
  status: "booked" | "slot_taken" | "slot_not_found";
  appointmentId?: string;
  slotId: string;
}
```

This adds `patientId` to the original plan's `book_appointment(slotId)`, because the stdio server has no session of its own.

### Valid inputs

- `patientId` matches `^P-\d{4}$` and `slotId` matches `^S-\d{4}$`. Seeded patients are `P-1001` to `P-1005`.
- `specialty` is one of `primary_care`, `cardiology`, `dermatology`, `neurology`. Input is trimmed and lower-cased, and spaces or hyphens become underscores, so `Primary Care` works. A well-formed but unknown specialty returns an empty slot list. A malformed one is an error.
- Booking is idempotent for the same patient and slot (same `appointmentId`). A different patient gets `slot_taken`.

### Tool errors

A failure is a normal MCP result with `isError: true` and a short fixed message that never echoes the input: `patientId must look like P-1234`, `slotId must look like S-1234`, `specialty must be a name such as primary_care`, or `No patient with that ID`. `@langchain/mcp-adapters` throws this as a `ToolException` on direct invocation and returns an error `ToolMessage` inside an agent.

### Synthetic data and PHI canaries

Every person is fictional. The seeded names are deliberately unusual so tests can search for them: `Quillfeather` (P-1001, born 1971-03-14), `Oakhollow`, `Thornbury`, `Marlowe-Finch`, `Ravenscroft`. None of these, and no date of birth, may appear in tool output, logs or API responses. P-1005 is over 90, so the tool reports `ageBand: "90+"`.
