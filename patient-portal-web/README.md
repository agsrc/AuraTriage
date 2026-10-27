# patient-portal-web

React 19, Vite 8, Tailwind v4 and React Router. Patient chat at `/`, nurse dashboard at `/nurse`. HTTP contract: [docs/contracts.md](../docs/contracts.md). Rules: [CLAUDE.md](../CLAUDE.md).

## Run it

| Command         | What you get                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `npm run dev`   | Portal on `http://localhost:5173`. Vite forwards `/api` to the orchestrator, so there is no CORS. |
| `npm run build` | Typecheck, then a production bundle in `dist/`.                                                   |
| `npm test`      | 48 tests (Vitest, Testing Library, jsdom, plus a contract test against the real server).          |

Start the API first, for example with `npm run dev:mock -w agent-orchestrator` from the repo root. If it is not on port 3001, set `API_PROXY_TARGET` in the root `.env`.

## How it works

- **No global store.** Each page uses a hook: `usePatientChat` sends messages, restores a conversation after a reload, and polls every 3 seconds while a nurse holds it; `useEscalationQueue` refreshes the nurse queue every 5 seconds.
- **Sessions are per tab.** The token and the opaque conversation ID are kept in `sessionStorage`, so a patient tab and a nurse tab can live side by side. Demo-grade; a real deployment would use an HttpOnly cookie.
- **Responses are validated.** The API client parses every response with the Zod schemas in `agent-orchestrator/src/contracts.ts` (imported as `@contracts`). A server that drifts from the contract fails loudly instead of rendering garbage.
- **The nurse route is protected by role.** It is not linked from the patient portal, but hiding it is not the control: a patient session sees the nurse sign-in, and the server checks the role on every endpoint.
- **Accessibility.** Every field has a label, the conversation is a `log` region, the emergency notice is an `alert`, icons are decorative, and motion respects `prefers-reduced-motion`. Biome's accessibility rules run in `npm run lint`.

## Tests

- `test/patient.test.tsx`, `test/nurse.test.tsx`: the UI flows, including the emergency banner, the hold and resume, the edit-needs-text rule, and expired sessions.
- `test/client.test.ts`: request building, error mapping, and rejecting responses that do not match the contract.
- `test/contract.test.ts`: boots the real orchestrator as a child process and walks sign-in, a normal turn, an escalation and the nurse's decision through the real client.
