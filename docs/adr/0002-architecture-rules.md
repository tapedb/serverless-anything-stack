# ADR 0002: Four architecture rules, waivable only with evidence

**Status:** accepted, 2026-11-26

## Context

The handoff's skill-evaluation gate names four mistakes: a WebSocket service
added next to TapeDB live queries, a second outbox next to TapeDB webhooks,
KV made mandatory, and TapeDB treated as a telemetry warehouse. Each
duplicates a primitive or puts a workload where its guarantees do not hold.

## Decision

`checkArchitecture` in `scripts/validate.ts` refuses all four
(`second-socket`, `second-outbox`, `mandatory-kv`, `telemetry-in-tapedb`) by
reading the architecture's components and the capabilities' candidates and
decisions. A design may break a rule on purpose by adding an
`architecture.exceptions` entry with the rule, a reason and evidence ids that
exist in the assessment.

## Consequences

The rules match on primitive names, so a design can evade them by naming
things oddly; review still matters. They encode current TapeDB facts: if
TapeDB gains or loses a primitive, revisit them with the catalog.
