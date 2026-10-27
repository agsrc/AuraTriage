# agent-orchestrator

Express 5 + LangGraph.js + TypeScript 7. It spawns the EHR MCP server over stdio, runs the triage graph, and pauses for a nurse on red flags and on requests for review. Design: [docs/architecture.md](../docs/architecture.md). HTTP contract: [docs/contracts.md](../docs/contracts.md). Rules: [CLAUDE.md](../CLAUDE.md).

## Run it

| Command                          | What you get                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run dev:mock`               | API on `:3001` with the offline model and a Node stand-in EHR. No JDK or API key needed.    |
| `npm run dev`                    | Same API, but it spawns the real Java server. Build the JAR first with `npm run ehr:build`. |
| `npm run build` then `npm start` | Compiled output in `dist/`.                                                                 |
| `npm test`                       | 155 tests (Vitest). Nothing here needs JDK 25 or a network.                                 |
| `npm run typecheck`              | `tsc --noEmit`, which also checks the edge and node typing tests.                           |

Run them from the repo root with `-w agent-orchestrator`, or from this folder. Configuration comes from `.env` at the repo root; see `.env.example`.

## How a turn works

`safety_gate` scans the patient's message with fixed patterns before any model is called. A hit shows the emergency notice and pauses at `human_escalation` (`interrupt()`). Otherwise `patient_intake` picks triage or booking, the agent calls tools through `tool_execution`, and the reply is returned. If an agent calls `request_nurse_review`, the run pauses the same way and its draft is withheld until a nurse approves, edits or rejects it.

The patient's ID never comes from the model. The chat service puts the signed-in ID in the run config, and the adapter's `beforeToolCall` hook ([src/mcp/ehr.ts](src/mcp/ehr.ts)) writes it into every patient-scoped tool call, failing the call if there is none.

## Tests worth knowing

- `test/redFlags.test.ts`: the golden set. Recall must stay at 100%.
- `test/graph.test.ts`: red flags skip the model, nurse decisions resume the run, tool allowlist, booking confirmation guard.
- `test/api.test.ts`: the whole stack over HTTP with the real MCP adapter and stand-in EHR, including the log-privacy check.
- `test/persistence.test.ts`: a pause survives closing the database and rebuilding the graph.
- `test/server.e2e.test.ts`: boots the real `server.ts` as a child process.

Not covered by tests: the Claude implementation (`src/llm/anthropic.ts`) needs a real key and has not been run.
