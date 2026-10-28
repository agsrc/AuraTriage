# Verification

The full build with the target toolchain (JDK 25, Node 26) was run on the Mac and works. The Windows dev machine has JDK 21 and Node 24 and cannot be upgraded, so it covers everything except the Java 24+ Gatherer classes. This page records what has and has not been checked.

## Run this on the Mac (or in CI)

This is the full check, and it passes on the Mac.

```
node scripts/doctor.mjs     # JDK >= 25, Node >= 24 (target 26), git, npm
npm ci
npm run ehr:verify          # Java unit tests, package the JAR, stdio integration test
npm run spike:mcp           # Node adapter <-> Java server over stdio
npm run typecheck           # tsc 7
npm test                    # Vitest, orchestrator and web
npm run build -w patient-portal-web   # typecheck and production bundle
npm run lint
```

Expected results:

| Command              | Expect                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run ehr:verify` | 50 unit tests pass (`ToolConfigTest` 5, `ClinicalServiceTest` 29, `VitalsTrendAnalyzerTest` 7, `EpisodeGatherersTest` 6, `AvailabilityAggregatorTest` 3), then `StdioSmokeIT` 3 of 3, then `BUILD SUCCESS` |
| `npm run spike:mcp`  | 11 lines starting `[ ok ]`, then `Spike passed.`, exit code 0, in about 6 s                                                                                                                                |
| `npm run typecheck`  | no output, exit code 0                                                                                                                                                                                     |
| `npm test`           | Orchestrator: `Test Files 10 passed`, `Tests 155 passed`. Web: `Test Files 5 passed`, `Tests 48 passed`                                                                                                    |
| `npm run lint`       | `No fixes applied.`                                                                                                                                                                                        |

Also worth doing once on the Mac:

```
git ls-files --stage ehr-mcp-server/mvnw     # should start with 100755
npx @modelcontextprotocol/inspector java -jar ehr-mcp-server/target/ehr-mcp-server.jar
```

The Inspector opens a browser UI where you can list the three tools and call them by hand.

For the orchestrator with the real Java server and the graceful-shutdown path:

```
npm run dev -w agent-orchestrator
```

Press Ctrl+C. You should see a `shutting down` log line and the process should exit with no `java` process left behind. This is a manual check because Windows ends a child process abruptly, so the signal handler cannot be tested there.

To see the whole product on the Mac, run the API and the portal in two terminals (`npm run dev:mock -w agent-orchestrator` and `npm run dev -w patient-portal-web`) and follow the tour in the README. Then repeat it with the real Java server: `npm run ehr:build`, then `npm run dev -w agent-orchestrator` in place of the first command.

## Verified on Windows (JDK 21, Node 24)

This was the only check available while the code was written. The Mac run above supersedes it for everything the two have in common.

### Java server (Step 2)

A throwaway copy of `ehr-mcp-server` was built with `-Djava.version=21`. In that copy the three Gatherer classes were replaced by plain-loop stand-ins with the same algorithms, because `java.util.stream.Gatherers` needs Java 24 or later. Results:

- All main code compiled against Spring Boot 4.1.2 and Spring AI 2.0.2, so the `@Tool`, `@ToolParam` and `MethodToolCallbackProvider` usage is correct.
- 41 unit tests passed: `ToolConfigTest`, `ClinicalServiceTest`, `VitalsTrendAnalyzerTest`. The expected episodes (2, 1, 2) and trend directions for the seeded patients were confirmed.
- `StdioSmokeIT` passed 3 of 3 against the packaged JAR as a real child process: stdout carried only JSON-RPC, all three tools were listed, booking worked end to end, error messages did not echo input, no PHI canary appeared in output, and the server exited when stdin closed.
- `npm run spike:mcp` passed 11 of 11 against that JAR.

### Orchestrator (Step 3)

The orchestrator uses nothing specific to Node 26, so it is tested in full on Node 24:

- `tsc` 7 is clean with `strict` and `noUncheckedIndexedAccess`. That includes type tests: each router returns only the nodes it should, and an edge to a node that was never registered fails to compile (an `@ts-expect-error` would turn into an error if LangGraph's types stopped catching it).
- 155 Vitest tests in 10 files pass. They cover the red-flag golden set (100% recall), config, JWT, the MCP hook, the graph (red flags skip the model, nurse decisions resume the run, tool allowlist, booking confirmation guard), the SQLite checkpointer and stores, the HTTP API with the real MCP adapter and stand-in EHR, and the real `server.ts` booted as a child process.
- A paused escalation survives closing the database and rebuilding the graph, and a nurse can then resume it.
- The compiled build (`npm run build`, `node dist/server.js`) and the `dev:mock` flags both start and answer `/api/health`.
- End to end with the real Java server, using the JDK 21 build from Step 2, over HTTP: a routine question was answered; P-1001's rising blood pressure, which comes from the Java data, escalated to the nurse queue; a booking completed; no PHI canary appeared in any output.
- Killing the orchestrator abruptly left no extra `java` process: both the Java server and the stand-in exit when their stdin closes.
- `package-lock.json` already contains the macOS (`darwin-arm64`, `darwin-x64`) binaries for TypeScript 7, esbuild, rolldown and lightningcss, so `npm ci` on an Apple Silicon Mac fetches the right ones.

### Web portal (Step 4)

Nothing in the portal depends on Node 26 either, so it was tested in full on Node 24:

- `tsc` 7 is clean and `vite build` succeeds (about 367 KB of JavaScript, 113 KB gzipped, 17.5 KB of CSS).
- 48 Vitest tests in 5 files pass. They cover the patient flows (sign-in, send, reply, hold and resume by polling, restoring a saved conversation, a 409 meaning "held", the assistant being unavailable, an expired session), the nurse flows (queue, detail, approve, edit needs text, reject, someone else resolved it first), the API client (request building, error mapping, rejecting a response that breaks the contract) and routing.
- `test/contract.test.ts` boots the real orchestrator process and runs the real web client against it: sign-in, a normal turn, an escalation, the nurse's decision, a model-requested review, and the typed errors for forbidden, unauthorized and not found.
- A manual walk-through in the built-in browser against the real API (offline model, stand-in EHR): sign-in; a message that makes the assistant ask for review (chat held, draft withheld); the nurse tab showing the concern and draft, then approving; the patient tab picking up the reply by itself; a red-flag message showing the "Call 911" banner, the emergency notice and the held composer; a 375 px phone layout; and the two-column nurse layout at 1280 px.
- That walk-through found one real bug the tests could not: the Vite proxy read the generic `PORT` variable, which the host had set to the web server's own port, so every API call failed with 502. The proxy now uses `API_PROXY_TARGET`.

## Verified on the Mac (JDK 25, Node 26)

The checks in "Run this on the Mac" pass. That covers the code that could not be built on Windows:

- `transform/VitalsTrendAnalyzer.java` (`Gatherers.windowSliding`), `transform/EpisodeGatherers.java` (a custom `Gatherer.ofSequential`) and `transform/AvailabilityAggregator.java` (`Gatherers.mapConcurrent`), the `.gather(...)` call in `service/ClinicalService.java`, and `EpisodeGatherersTest` and `AvailabilityAggregatorTest`.
- The `-Djava.version=25` build and the orchestrator and portal running on Node 26.

## Not checked yet

- **Claude.** `LLM_PROVIDER=anthropic` (`src/llm/anthropic.ts`) needs a real API key and has never been run. With a key, first try one routine message and one booking, and check that tool calls use the `SESSION` placeholder and that `request_nurse_review` appears for an urgent-sounding case.
- **Graceful shutdown** (the Ctrl+C check above). Windows ends child processes abruptly, so this path can only be checked on the Mac.

Web portal:

- **Other browsers.** Only the built-in Chromium-based pane was used. Safari on the Mac is worth a look, in particular `field-sizing: content` on the message box (it falls back to a one-line box) and the `:has()` selector that highlights the chosen radio option.
- **Assistive technology.** The semantics are in place (labels, `log` and `alert` regions, decorative icons hidden) and Biome checks the accessibility rules, but no screen reader was used.
- **Keyboard-only use** was not walked through end to end.
