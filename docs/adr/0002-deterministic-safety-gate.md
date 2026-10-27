# ADR 0002: deterministic safety gate before the LLM

Status: accepted

## Context

Severe symptoms such as chest pain must reach a nurse. Relying on an LLM to notice them is non-deterministic and fails when the model or provider is down.

## Decision

A `safety_gate` node runs first on every patient message. It uses deterministic pattern matching; an LLM risk classifier may add escalations but can never remove one. If the classifier errors, the gate escalates. On a match the patient sees a static emergency message immediately, and the graph pauses at `human_escalation` with `interrupt()` for a nurse to own the disposition.

## Consequences

- Some false positives (over-escalation). In triage that is the safe direction.
- The pattern list is clinical content and needs review before any real use.
- Emergency guidance never waits for the nurse.
