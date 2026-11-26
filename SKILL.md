---
name: serverless-anything
description: Assess a self-hosted application (any repository) and design or build an evidence-based Cloudflare-native alternative with no VPS, reusing TapeDB and Cloudflare primitives where their guarantees fit. Use when asked to port, adapt, replace or assess self-hosted software for Cloudflare Workers.
---

# Serverless Anything

Turn "can this run on Cloudflare without a server?" into a checked answer: a
pinned audit of the upstream, a capability matrix in which every claim has
evidence and a test, an architecture that reuses what exists, and, when asked,
working code with tests. A service mapping is not feature parity; this skill
never says otherwise.

Paths below are relative to this file.

## Before starting

1. Read `references/methodology.md` (the procedure and the status rules) and
   skim `catalog/tapedb.json` and `catalog/cloudflare.json` (what each platform
   guarantees, with sources and dates).
2. Re-check anything in the catalogs older than the task needs: a Cloudflare
   limit, a price, a TapeDB release. Look at the registry and the docs, not at
   memory. Update the catalog entry and its `checkedAt` when you do.
3. If the user names an upstream repository, pin it: clone it and record the
   commit. Everything after this refers to that commit.

## Procedure

1. **Audit the upstream at the pinned revision.** Manifests, lockfiles,
   process files (Procfile, compose, Helm), schema and migrations, routes, jobs
   and schedules, realtime channels, auth and protocols, integrations, tests.
   Trace each important feature end to end. Cite file paths; a README is not
   proof. Record the license (see `references/security.md` for clean-room
   rules).
2. **Inventory features and classify each by workload:** transactional,
   realtime, asynchronous, ingestion, analytical, object-storage,
   identity-protocol, compute.
3. **Choose an approach:** direct port, component adaptation, compatible
   rewrite, or infeasible. A JVM, Rails or Django server is not a Worker; say
   so and choose a rewrite or a non-serverless answer.
4. **Map each capability** to a candidate, preferring existing high-level
   primitives (TapeDB, then Cloudflare products) over new code, and recipes in
   `recipes/` over invention. Record semantic gaps: what the candidate does
   differently, not only what it lacks.
5. **Write the assessment** as `cases/<name>/assessment.json` against
   `schemas/assessment.schema.json`, and a short `report.md` beside it.
6. **Validate:** `bun run check`. The validator refuses `verified` without
   upstream evidence, dated candidate evidence and a passing test; refuses
   `partial` without gaps; refuses a second socket service next to TapeDB live
   queries, a second outbox next to TapeDB webhooks, mandatory KV, and
   ingestion workloads placed in TapeDB, unless an `architecture.exceptions`
   entry gives the reason and evidence.
7. **If asked to implement,** build the smallest fixture that proves a claim
   (see `examples/`), run it, and only then raise the capability's status.
   Label each result with where it ran: `local`, `workerd-local`, `deployed`
   or `manual`.

## Rules

- Statuses mean what `references/methodology.md` says. `verified` needs a test
  that passed; "should work" is `unverified`.
- Local results are not deployed results. A capacity number from a laptop is
  not a capacity number.
- No exactly-once claims across services. An outbox gives at-least-once; a
  ledger and idempotency keys bound duplicates; say which.
- Do not add a WebSocket service, an outbox, a job runner, a cache or an auth
  system that a chosen primitive already provides.
- Do not put telemetry, logs or raw events into TapeDB workspaces; one
  workspace has one writer.
- Domain protocols (SAML, LDAP, Sentry envelopes, WhatsApp, email providers)
  stay in application code or external services, not in the database.
- Costs come from current official pricing with stated volumes, or are marked
  UNPRICED (`references/costing.md`).
- Do not deploy to production, publish packages or send messages without the
  owner's explicit go-ahead. Report blockers instead of working around them.

## Output

For an assessment: the validated `assessment.json`, a `report.md` (approach,
matrix summary, gaps, risks, decisions, what was tested where, what was not),
and a backlog of the tests still marked `not-run`. For an implementation: the
code, its tests, and the assessment updated with the results.

The three cases in `cases/` (Keycloak, Chatwoot, GlitchTip) are worked
examples; read one before writing a new assessment.
