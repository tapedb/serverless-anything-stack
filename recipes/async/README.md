# Asynchronous work and external delivery

**Use when** something must happen after a write and outside the request:
sending to a provider, calling another system, timers and SLAs.

**Shape:** a TapeDB webhook (captured in the write's transaction, delivered
after durability, signed, ordered per endpoint, at-least-once) to a Worker
that enqueues; a Queues consumer does the work; Workflows for multi-step work
and timers; Cron Triggers for scans. A delivery ledger row in the tenant's
workspace records each attempt and the provider's id.

**Do not** add a second outbox table: TapeDB webhooks are the outbox. Do not
use webhooks as a job queue: they deliver row changes to an endpoint and
nothing else.

**Failure handling**

- Consumers are idempotent: key work by the message or event id.
- Ack per message, so one poison message fails alone; after `max_retries` it
  goes to a dead-letter queue whose consumer records it where operators look.
- Providers may still receive a message twice; pass their idempotency key
  where they have one, and reconcile the ledger against the provider.
- TapeDB's `$webhooks()` and `$webhookRetry()` show and move a stuck
  endpoint; a revived event keeps its order position.

**Tested by:** `examples/ingest` (per-message acks, a poison message retried
and dead-lettered without holding back its sibling, a redelivery counted
once). A provider-delivery fixture with a failing provider is still to do
(Chatwoot `t.fixture-delivery`).
