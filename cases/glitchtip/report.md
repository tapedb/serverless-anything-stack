# GlitchTip: assessment

Generated from `assessment.json` by `bun scripts/report.ts`. Do not edit by hand.

- **Upstream:** https://gitlab.com/glitchtip/glitchtip-backend at `76307e829cd1f4a72d2099e9067f6f1e11a05494` (inspected 2026-11-26)
- **License:** MIT
- **Approach:** compatible-rewrite
- **Capabilities:** 5 partial, 6 unverified

## Architecture

A compatible rewrite that keeps raw events out of TapeDB: a Worker accepts Sentry envelopes, acknowledges after enqueuing to Queues, consumers group events and write issue rows to a TapeDB workspace per organization, raw events go through Basin Pipelines into R2 Iceberg tables for search and retention, and alerts go out through TapeDB webhooks or Queues.

| component | primitive | responsibility |
| --- | --- | --- |
| Ingest Worker | Workers + Queues | DSN check, size limits, enqueue, ack |
| Grouping consumer | Queues consumer | fingerprint, upsert issue rows in batches |
| Organization workspace | TapeDB workspace | orgs, projects, issues, assignments, alert rules; live issue lists |
| Event store | Basin Pipelines, R2 Iceberg, Basin SQL | raw events, retention, event search |
| Alerts | TapeDB webhooks into Queues | email and webhook notifications |

## Capability matrix

| capability | status | decision | candidate | gaps | tests |
| --- | --- | --- | --- | --- | --- |
| Acknowledge an event only once it is durably accepted | partial | external | Worker sends to Queues before responding | Verified in workerd with local Queues only; not run against deployed Queues. Envelope parsing covers event items; attachments, sessions and transactions items are ignored. | t.fixture-ingest (pass, workerd-local) |
| Issue rows, status, assignment with live lists | partial | reuse | TapeDB models and live queries in a workspace per organization | Write throughput of one organization's workspace at ingest rate not benchmarked; the consumer writes one transaction per event. | t.select (pass, deployed), t.live-order (pass, deployed), t.fixture-grouping (pass, workerd-local) |
| Fingerprinting compatible with Sentry SDK grouping | partial | external | Application code in the consumer | Simplified fingerprinting (explicit fingerprint, last exception type and value with numbers removed, or message); not compared against Sentry's grouping. | t.fixture-grouping (pass, workerd-local) |
| Organizations, teams, projects, DSN keys, membership | partial | reuse | TapeDB built-in auth with membership and a workspace per organization | DSN key lookup at the ingest edge needs a fast path outside the workspace (cache). |  |
| Alerts on new or regressed issues | partial | reuse | TapeDB webhooks on issue rows into a Queues consumer | Webhook delivery is verified; alert rule evaluation is application code. | t.webhooks (pass, workerd-local) |
| Rate limits and quotas per project | unverified | external | Workers rate limiting binding plus counters | Not assessed. |  |
| OTLP logs and traces | unverified | external | Same ingest path into Basin | Not assessed. |  |
| Raw event storage and search | unverified | external | Basin Pipelines into R2 Iceberg; Basin SQL | Basin SQL latency for interactive event lists not measured. TapeDB is not an event store and is not used here. |  |
| Retention windows per organization | unverified | external | Iceberg partition expiry; TapeDB rows deleted by a scheduled job | Not assessed. |  |
| Uptime monitors | unverified | external | Cron Triggers | Not assessed. |  |
| Source maps and native symbolication | unverified | exclude | Source maps in a Worker; native debug files not assessed | Native symbolication may exceed Worker CPU and memory limits. |  |

## Tests

| test | runtime | result | ran | command |
| --- | --- | --- | --- | --- |
| Typed reads and writes in workerd and on staging | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only select (tapedb)` |
| Live diffs keep order when rows move | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only live-order (tapedb)` |
| Signed webhooks delivered in order with retries | workerd-local | pass | 2026-11-26 | `node scripts/e2e.mjs --only webhooks (tapedb)` |
| Envelope accepted only after enqueue; unknown key refused; poison event retried, dead-lettered and recorded; siblings not held back | workerd-local | pass | 2026-11-26 | `cd examples/ingest && npm test` |
| Issues grouped by fingerprint; counts summed from per-message tallies; a redelivered message counts once | workerd-local | pass | 2026-11-26 | `cd examples/ingest && npm test` |

## Risks

- **Writing raw events into a workspace would hit the single-writer limit.** Raw events never enter TapeDB; only batched issue upserts do.
- **Event search through Basin SQL may be too slow for interactive views.** Measure before committing; keep the latest events per issue in the workspace.
- **TapeDB's /v1/transact takes wire ops as they are and does not apply schema defaults; an insert missing a defaulted field is refused (invalid_op).** The consumer spells out every defaulted field; reported upstream as a documentation gap.

## Decisions

### Keep raw events out of TapeDB (proposed)

GlitchTip stores events in partitioned Postgres and cold Parquet.

- Events in TapeDB workspaces: One writer per organization; storage and rows billed per event.
- **Events in Basin; issues in TapeDB** (chosen): Two stores; each fits its workload.

Event search goes to Basin SQL; issue lists stay live through TapeDB.

## Cost drivers

- **Queue operations:** About 3 operations per event before batching. (cf.queues-pricing)
- **Basin SQL:** Event search billed per TB scanned. (cf.basin-pricing)
- **Workspace writes:** Batched issue upserts; volume not modelled. (cf.do-pricing)

## Workload assumptions

- Ingest volume is bursty and far above what one Durable Object writer should absorb; events must not go through a workspace's write path.
- Issue state (status, assignee, counts) is small and per project.

## Upstream dependencies

- PostgreSQL 18: primary store with partitions
- Valkey: task broker and cache (optional)
- DuckDB and Parquet: cold storage queries (optional)
