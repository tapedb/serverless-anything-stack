# Chatwoot: assessment

Generated from `assessment.json` by `bun scripts/report.ts`. Do not edit by hand.

- **Upstream:** https://github.com/chatwoot/chatwoot at `eb4fabb4c928a01b69bcd752cb473cba6b4b2da9` (inspected 2026-11-26)
- **License:** MIT (outside enterprise/); enterprise/ under enterprise/LICENSE
- **Approach:** compatible-rewrite
- **Capabilities:** 2 verified, 6 partial, 5 unverified, 1 not-applicable

## Architecture

A compatible rewrite: TapeDB workspaces per account hold the domain model with access rules; live queries replace ActionCable for inbox and widget; TapeDB presence and broadcast replace the Redis presence set and typing signals; R2 files hold attachments; TapeDB webhooks trigger outgoing events; Queues and Workflows carry provider delivery, retries, SLA timers and auto-resolution, with a delivery ledger in the workspace. No second WebSocket server and no per-conversation Durable Object.

| component | primitive | responsibility |
| --- | --- | --- |
| Account workspace | TapeDB workspace | contacts, conversations, messages, teams, labels, assignment, unread counts |
| Inbox UI and widget | TapeDB live queries, presence, broadcast, client outbox | live lists, typing, availability, offline drafts |
| Attachments | TapeDB files on R2 | uploads with file rules |
| Delivery | TapeDB webhooks into Queues; Workflows for multi-step delivery | provider sends, retries, dead letters, ledger updates |
| Timers | Workflows (sleep, waitForEvent) or Cron Triggers | auto-resolve, SLA breaches, scheduled campaigns |

## Capability matrix

| capability | status | decision | candidate | gaps | tests |
| --- | --- | --- | --- | --- | --- |
| No account sees another's data | verified | reuse | A workspace per account; claims are scoped to one workspace |  | t.fixture-isolation (pass, workerd-local) |
| Live inbox, conversation and widget views | verified | reuse | TapeDB live queries over one socket per workspace |  | t.relation-live (pass, deployed), t.live-order (pass, deployed) |
| Typed domain model with serializable writes per account | partial | reuse | TapeDB models and transactions in one workspace per account | The fixture models contacts, conversations, messages, assignment and unread; teams, labels, macros, automation rules, campaigns and the help centre are not modelled. | t.select (pass, deployed), t.fixture-inbox (pass, workerd-local) |
| Messages ordered within a conversation, including under concurrent sends | partial | reuse | TapeDB's single writer and log sequence | Ordering of provider-delivered inbound messages depends on provider timestamps and is not covered. | t.live-order (pass, deployed), t.fixture-inbox (pass, workerd-local) |
| Agent and contact presence and typing indicators | partial | reuse | TapeDB presence for availability; broadcast topics for typing | Presence fan-out grows with the square of the room (60 ms p50 at 200 peers); large accounts should scope presence rooms per inbox or team. Upstream keeps contacts present for 90 s across widget pings; TapeDB presence ends with the socket. | t.presence (pass, deployed), t.broadcast (pass, deployed) |
| Attachments with per-conversation authorization | partial | reuse | TapeDB files on R2 with file rules | File rules decide per file path; mapping them to conversation membership is application work. | t.file-rules (pass, deployed) |
| Signed outgoing webhooks for account events | partial | reuse | TapeDB webhooks (transactional capture, signed, ordered per endpoint, at-least-once); $webhooks() and $webhookRetry() to inspect and move a stuck endpoint | TapeDB's payload is a row change; Chatwoot's webhook payloads are event-shaped (message_created, conversation_status_changed) and need a mapping. | t.webhooks (pass, workerd-local) |
| Agent sign-in, 2FA, SSO | partial | reuse | TapeDB built-in auth (Better Auth) with membership roles | SAML SSO (omniauth-saml upstream) is not provided. |  |
| Outbound replies through email, WhatsApp, SMS and social providers | unverified | external | Queues consumers per provider, fed by TapeDB webhooks or direct sends, with a delivery ledger row per message in the workspace | No exactly-once: providers may receive a message twice; the ledger and provider idempotency keys bound it. Provider quotas and channel rules are per provider. | t.fixture-delivery (not-run) |
| Inbound provider webhooks with signature verification | unverified | external | Worker routes per provider writing to the account workspace | Provider-specific. |  |
| Auto-resolution, SLA monitors and scheduled items | unverified | external | Workflows (sleep and waitForEvent per conversation) or Cron Triggers scanning workspaces | A per-conversation Workflow per SLA is a design choice not yet benchmarked against a cron scan. |  |
| Message and help-centre search | unverified | reuse | TapeDB filters ($ilike) for simple search; TapeDB vector and hybrid search (one indexed model) for the knowledge base | No full-text index across messages in TapeDB; $ilike scans. Vector search indexes one model per deployment. |  |
| Reporting events and rollups | unverified | reuse | TapeDB aggregates and named SQL within an account; Basin for cross-account analytics | TapeDB is not a warehouse; cross-account reports need a separate store. |  |
| AI assistant and embeddings | not-applicable | exclude | Not assessed; enterprise-licensed upstream |  |  |

## Tests

| test | runtime | result | ran | command |
| --- | --- | --- | --- | --- |
| Typed reads and writes in workerd and on staging | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only select (tapedb)` |
| Live diffs keep order when rows move | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only live-order (tapedb)` |
| Live queries over relations update | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only relation-live (tapedb)` |
| Presence rooms, refusals and peer lists | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only presence (tapedb)` |
| Broadcast topics between clients | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only broadcast (tapedb)` |
| File rules decide reads and writes | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only file-rules (tapedb)` |
| Signed webhooks delivered in order with retries | workerd-local | pass | 2026-11-26 | `node scripts/e2e.mjs --only webhooks (tapedb)` |
| Inbox fixture: conversation, messages, unread as a live count, 30 concurrent sends all land in order | workerd-local | pass | 2026-11-26 | `cd examples/inbox && npm test` |
| A claim for one account presented to another's workspace is refused (403 wrong_workspace) | workerd-local | pass | 2026-11-26 | `cd examples/inbox && npm test` |

Not run yet (the backlog):

- `t.fixture-delivery` (workerd-local): Outbound delivery with a failing provider: retries, dead letter, ledger

## Risks

- **A large account's writes and presence all go through one workspace.** Benchmark with the fixture; scope presence rooms per inbox; split an account only if measurements demand it.
- **At-least-once queues can send a reply twice.** Ledger row per outbound message with a provider idempotency key where the provider supports one.

## Decisions

### Use TapeDB live queries and presence instead of a separate WebSocket service (proposed)

Chatwoot uses ActionCable on Redis for live updates and presence.

- **TapeDB live queries and presence** (chosen): No extra service; verified primitives; presence fan-out limits large rooms.
- A separate WebSocket Durable Object per conversation: Duplicates TapeDB's socket and invalidation; two sources of truth.

One socket per account workspace per client; presence rooms are scoped to keep fan-out small.

### Queues and Workflows for background work, not TapeDB webhooks alone (proposed)

Chatwoot runs 18 Sidekiq queues and cron schedules.

- TapeDB webhooks as the job system: Webhooks are row-change delivery to an endpoint, not a job queue; no scheduling.
- **Queues and Workflows fed by TapeDB webhooks** (chosen): Two systems to operate; each does what it is for.

A delivery ledger in the workspace reconciles what the queue did.

## Cost drivers

- **Workspace requests and rows:** Every message write and live re-run is billed as Durable Object requests and rows; not modelled yet. (cf.do-pricing)
- **Queue operations:** About 3 operations per outbound message plus 1 read per retry. (cf.queues-pricing)

## Workload assumptions

- One TapeDB workspace per Chatwoot account; a busy account's inbox writes go through one writer.
- Live views are per agent; an account with many agents online is the hot case for fan-out.

## Upstream dependencies

- PostgreSQL (with pgvector): primary store
- Redis: ActionCable pub/sub, Sidekiq, presence
- Sidekiq and sidekiq-cron: background jobs and schedules
- Elasticsearch/OpenSearch via searchkick: advanced message search (optional)
- S3-compatible storage: attachments (optional)
