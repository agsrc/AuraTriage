# ADR 0001: stdio first for the MCP transport

Status: accepted

## Context

The orchestrator and the EHR server run on one developer machine. Spring AI supports a stdio starter and a Streamable-HTTP starter.

## Decision

Use stdio. The orchestrator spawns the JAR as a child process.

## Consequences

- No ports, no network auth, nothing to deploy for the demo.
- One JVM per orchestrator process, and a start-up cost of a few seconds.
- stdout is reserved for JSON-RPC, so logging goes to stderr via `logback-spring.xml`, and `StdioSmokeIT` fails the build if anything else reaches stdout.
- Spring AI 2.0 does not enable stdio by default. `spring.ai.mcp.server.stdio=true` is required.
- The server cannot be shared across containers. If that is needed, add a Streamable-HTTP profile behind the same tool contracts. Not built in the MVP.
