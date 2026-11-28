# Methodology

## Evidence

Every claim points at evidence in the assessment's `evidence` list:

| kind | what it is | needs |
| --- | --- | --- |
| `source` | a file at the pinned upstream revision | `revision` |
| `manifest` | a lockfile, Procfile, compose file, Gemfile, pom.xml | `revision` |
| `documentation` | vendor or project documentation | `checkedAt` |
| `pricing` | an official pricing page | `checkedAt` |
| `test` | a test that ran (here, in TapeDB, or upstream) | `checkedAt` |
| `run` | a measured run: benchmark, deployed check | `checkedAt` |

Marketing copy and READMEs describe intent. Cite them only for intent.

## Statuses

| status | means | the validator requires |
| --- | --- | --- |
| `verified` | the candidate does what the upstream feature needs, and a test showed it | upstream evidence, dated candidate evidence, an acceptance test with `result: pass`, no gaps |
| `partial` | it covers part; the rest is named | at least one gap |
| `unverified` | plausible, not tested | nothing; this is the honest default |
| `unsupported` | the candidate cannot do it | decision is not `reuse` |
| `not-applicable` | out of scope for this assessment | decision `exclude` |

A candidate described as "deployed" needs a test with `runtime: deployed` that
passed. Raise a status only after the test runs; lower it as soon as a gap is
found.

## Decisions

- `reuse`: an existing primitive covers it (TapeDB, a Cloudflare product, a library).
- `extend`: an existing primitive plus application code or configuration.
- `external`: a separate service or Cloudflare product outside TapeDB.
- `exclude`: deliberately not built; say why in `gaps`.

## Approaches

- **Direct port**: the upstream runs on Workers as is or with build changes.
  Rare for server frameworks.
- **Component adaptation**: keep the upstream, swap a component (its database,
  its queue) for a Cloudflare one.
- **Compatible rewrite**: new code that is compatible at the boundary the
  users see (an API, a protocol, an SDK) and reuses primitives inside. No code
  copied from the upstream unless its license allows it and it is attributed.
- **Infeasible**: say what blocks it (a JVM, raw TCP listeners, GPU, kernel
  features) and what the nearest honest alternative is.

## Verdict

The answer handed to the owner at Gate 1, in `assessment.json` `verdict`:

| recommendation | means | the validator requires |
| --- | --- | --- |
| `go` | everything the owner needs can be built serverless | no `excluded` entries |
| `go-with-exclusions` | the core can; some parts cannot or will not be built | `excluded`, each with its nearest alternative |
| `no-go` | the core cannot run without a server | `alternative`; the approach is `infeasible` or another approach that still cannot meet the goal |

An `infeasible` approach is always `no-go`. An `undecided` approach has no verdict.

## Failure design checklist

For each asynchronous or cross-service path record: what acknowledges, what is
durable at that point, how a retry is identified (idempotency key, message id,
`clientTxId`), ordering, the dead-letter path and who reads it, reconciliation
(a ledger that can be compared with the provider), backpressure, tenancy
boundaries, deletion and retention. Never imply atomicity across TapeDB,
Queues and R2.

## Tests

Name acceptance tests before building, with the runtime they will run in
and their `level` (unit, integration, e2e, load, security, smoke; see
`testing.md`). A
test that has not run is `result: not-run`; the list of those is the backlog.
An application's fixtures and spikes live in its own repository. They use the
published packages, never source checkouts.
