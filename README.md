# AuraTriage

Agentic healthcare triage MVP: a Java MCP server (mock EHR), a LangGraph.js orchestrator with a human-in-the-loop nurse escalation, and a React patient portal. **Synthetic data only. Not a medical device.**

```
patient-portal-web (React) --HTTP--> agent-orchestrator (Node, LangGraph) --MCP/stdio--> ehr-mcp-server (Java)
```

See [docs/architecture.md](docs/architecture.md), [docs/contracts.md](docs/contracts.md), [docs/threat-model.md](docs/threat-model.md), [docs/evals.md](docs/evals.md) (how to score a model) and [CLAUDE.md](CLAUDE.md) for the engineering rules.

## Build steps

| Step | Scope                              | Status                                                                                                      |
| ---- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 0    | Toolchain: JDK 25, Node 26         | Done on the Mac. The Windows dev machine is stuck on JDK 21 and Node 24                                     |
| 1    | Scaffold, `CLAUDE.md`, contracts   | Done                                                                                                        |
| 2    | Java MCP server + connection spike | Done. Verified on the Mac with JDK 25, see [docs/verification.md](docs/verification.md)                     |
| 3    | Node LangGraph orchestrator        | Done. Tested on Windows (Node 24) and verified on the Mac                                                   |
| 4    | React portal and nurse dashboard   | Done. Tested on Windows (Node 24) and verified on the Mac, see [docs/verification.md](docs/verification.md) |

## Quick start

```
node scripts/doctor.mjs     # checks JDK >= 25 and Node >= 24 (target 26)
npm install
npm run lint
npm run typecheck
npm test
```

To try the whole thing without Java or an API key (offline demo model, stand-in EHR), start the API in one terminal:

```
npm run dev:mock -w agent-orchestrator
```

and the portal in another:

```
npm run dev -w patient-portal-web
```

Open http://localhost:5173 for the patient chat and http://localhost:5173/nurse in a second tab for the nurse dashboard. Each tab keeps its own sign-in, so one browser can be both. A short tour:

1. As patient P-1001, send "I feel dizzy and have a headache". The assistant asks a nurse to review, and the chat is held.
2. In the nurse tab, open the escalation, read the assistant's concern and withheld reply, and approve it. The patient's tab shows the reply on its own.
3. Send "I have chest pain". The emergency notice appears at once, before any nurse sees it.

`mise install` reads `mise.toml` and sets up JDK 25 and Node 26 on both Windows and macOS (https://mise.jdx.dev).
