# TapeDB: when it fits and when it does not

Facts, limits and sources are in `catalog/tapedb.json` (checked against
`@tapedb/tapedb@0.4.2` on npm, 2026-11-26). This page is the judgement.

## The shape

One SQLite Durable Object per **workspace**. A workspace is the unit of
transactions, rules, live queries, presence, files, history and recovery.
Writes in one workspace are serializable with one writer; nothing is atomic
across workspaces. Choose the workspace boundary first: it is the tenancy
boundary, the consistency boundary and the throughput ceiling at once.

Good boundaries: an account, an organization, a team, a document, a project.
Bad boundaries: "everything" (one writer for every tenant), "one per row" (no
transactions across rows that belong together).

## Reuse instead of building

| need | TapeDB primitive | do not add |
| --- | --- | --- |
| typed state, relations, transactions | models, `$transaction`, `upsert` inside the engine | an ORM over D1 for the same data |
| permissions | `role()`, `filter()`, `check()` rules | a permission service |
| live views | live queries (`subscribe`, `useLive`) | a WebSocket server, a DO per room |
| typing, availability | presence and broadcast topics | Redis pub/sub |
| offline writes | client outbox with `clientTxId` | a sync layer |
| attachments | files on R2 with file rules | signed-URL services |
| change notifications to other systems | webhooks (transactional capture, signed, ordered per endpoint, at-least-once) | a second outbox table |
| backend writes | admin HTTP API (`/v1/query`, `/v1/transact`) | direct Durable Object calls |
| sign-in, sessions, membership | built-in auth (Better Auth on the AuthRoom) | another session store |
| similarity search | vector, text and hybrid search (Vectorize, one indexed model) | a second vector store for the same model |
| operating a workspace | `/metrics` with health, `/queries` profiles, webhook inspection and retry | ad-hoc debug routes |

## Where it does not fit

- **Jobs, timers, schedules:** Queues, Workflows, Cron Triggers. TapeDB
  webhooks can *feed* a queue; they are not one.
- **Telemetry and analytics across tenants:** a data plane (Queues or
  Pipelines into R2 Iceberg tables, queried with Basin SQL). TapeDB holds the
  control plane: issues, settings, alert state.
- **High write rates into one tenant:** past about four concurrent writers a
  workspace's latency rises instead of its throughput (local benchmark).
  Batch, or split the tenant along a real boundary.
- **Large rooms of presence:** fan-out grows with the square of the room (60
  ms p50 at 200 peers, local). Scope rooms to an inbox, a document, a team.
- **Cross-workspace views:** `$across` merges reads on the client (default 64
  workspaces at once; 1,000 workspaces in about 4 s deployed). It is not a
  query engine; precompute rollups where a view spans many tenants.
- **Protocols:** SAML, LDAP, OIDC conformance beyond Better Auth's plugins,
  Sentry envelopes, provider channels. Application code.

## Known gaps to design around (0.4.2)

- The admin HTTP API applies wire ops as given; it does not fill schema
  defaults. Spell out every defaulted field in `/v1/transact` inserts.
- Better Auth flows that write inside `runWithTransaction` (organization
  membership changes, OAuth client registration, passkey registration with a
  session) can leave partial writes; the adapter has no multi-call
  transactions. A raced authorization code redeems at most once, and under a
  race the first redemption can be refused too.
- The admin routes added in 0.4 (`/metrics`, `/webhooks*`, `/queries`) came
  after TapeDB's last security review.
- In projects made by `init` before 0.4.2, `npx tapedb-cli` resolves to a
  deprecated registry package; pin `@tapedb/cli` to the same version as
  `@tapedb/tapedb`.
