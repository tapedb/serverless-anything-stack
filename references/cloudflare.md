# Cloudflare primitives: choosing

Limits, prices and sources are in `catalog/cloudflare.json` (checked
2026-11-26). Re-check before relying on a number.

| workload | first choice | notes |
| --- | --- | --- |
| request handling, APIs, edge validation | Workers | 128 MB memory; 10,000 subrequests per invocation on paid plans; 6 simultaneous outgoing connections |
| tenant state with transactions | TapeDB workspace (a SQLite Durable Object) | see `tapedb.md`; plain Durable Objects only for state TapeDB does not model |
| shared relational data read by every tenant | D1 | one database, one writer; not for per-tenant hot paths |
| background work, fan-out, provider delivery | Queues | at-least-once, batches, `max_retries` (default 3), dead-letter queue kept 4 days; idempotent consumers |
| multi-step work, timers, waiting for events | Workflows | durable steps, sleeps, `waitForEvent`; per-instance step limits |
| schedules | Cron Triggers | scan or enqueue; keep the handler short |
| blobs, archives, attachments | R2 | not a query engine |
| events, logs, analytics at volume | Basin: Pipelines into R2 Iceberg tables, Basin SQL | GA since 2026-10-01; billed per TB scanned; measure query latency before promising interactive views |
| sampled metrics | Workers Analytics Engine | sampled, 3 months retention, 250 data points per invocation: not for exact event exploration |
| key-value lookups at the edge | KV | eventually consistent; only where a cache is justified and the system works without it |
| similarity search | Vectorize (directly, or through TapeDB) | eventually consistent |
| operational logs | Workers Logs | for diagnosis, not product data |

Not yet assessed here: K2 durable logs (a candidate ingestion buffer) and the
Email Service binding. Mark designs that depend on them `unverified`.

## Things that are not available

No VPS, no long-running processes, no listening TCP servers, no JVM, no
Ruby or Python application servers, no GPUs in Workers. Containers exist on
Cloudflare, but a design that needs one is not "serverless" in this skill's
sense; say so and record it as the approach.
