---
name: serverless-anything-stack
description: "Build a serverless, Cloudflare-native version of any self-hosted app or product idea (a GitHub equivalent to host my code, or a repo URL) end to end. Assesses feasibility and hands over a report, then on approval does the engineering: MoSCoW, use cases, diagrams, build, tests, e2e, deployments. Use to port, rebuild, replace or assess self-hosted software for Cloudflare Workers."
---

# Serverless Anything Stack

The owner says what they want, for example "i want to build a github
equivalent to host my codebases", through whatever their agent uses to call
a skill (a slash command, the skill's name, or a plain request).
This skill takes it from there to a running application on Cloudflare with no
server: it finds out whether it can be done, says so in a report, and once
the owner approves, engineers it: requirements by MoSCoW, use cases,
diagrams, code, unit, integration and e2e tests, preview, staging and
production deployments, a runbook.

Evidence rules hold throughout. A capability is `verified` only when a test
passed, a must is done only when its acceptance tests passed, an environment
is deployed only when e2e tests ran against it. A service mapping is not
feature parity; this skill never says otherwise.

Paths below are relative to this file. `<skill>` means this folder.

## Requirements on the agent

This skill assumes no particular agent or model. It needs a shell, git,
Node.js 22.18 or newer, network access to package registries and the
documentation it cites, and a way to ask the owner a question and wait for
the answer. It uses no agent-specific tools: where it says "ask", ask in
plain text; where it says "track", keep a checklist in
`docs/serverless/project.json` (milestones) or wherever the agent tracks
work. If the agent cannot run commands, do phases 0 to 5 and hand the owner
the commands for the rest.

## Phases and gates

| phase | output | gate |
| --- | --- | --- |
| 0 Intake | goal in the owner's words, reference upstreams pinned | none |
| 1 Assess | `assessment.json` with capabilities, evidence, verdict | none |
| 2 Report | `report.md` + draft MoSCoW, handed to the owner | **Gate 1: owner approves scope** |
| 3 Requirements | `project.json`: actors, MoSCoW requirements, use cases with acceptance tests | none |
| 4 Design | diagrams, ADRs, API contract, data model, failure design, cost | none |
| 5 Plan | milestones, walking skeleton first | none |
| 6 Build | the application, in slices, tests first | **Gate 2: Cloudflare account and go-ahead before the first deploy** |
| 7 Test | unit, integration (workerd), e2e (deployed), load, security | none |
| 8 Deploy | preview per branch, staging, production | **Gate 3: owner go-ahead for production** |
| 9 Handover | `delivery.md`, README, runbook, open work | none |

Run phases 0 to 2 without stopping: read, clone, research and write freely.
Stop at Gate 1 and present the report. If nobody answers (a scheduled or
unattended run), the report is the deliverable; do not start engineering.
After Gate 1, run phases 3 to 7 without asking again except for the gates
and for decisions that cannot be undone. Small product choices are yours:
make them, record them as decisions, list them in the handover.

`node <skill>/scripts/validate.ts <dir>` enforces the gates: it refuses
milestones under way or environments deployed without an approval, a done
milestone whose tests have not passed, a staging or production deploy without
`approvedBy` and deployed e2e tests, and production while a must is not done.
Run it after every phase.

## Where things live

Everything a run produces goes in the application's own repository: the
assessment, the report, spikes, code, tests, deploy records. Never write
into this skill's folder or its repository, never add the run to it as a
case or an example, and never record what was tested here. The skill stays
the same from one run to the next; only catalog facts you re-checked
(phase "Before starting") may be proposed back, as a separate change the
owner reviews.

The application gets its own repository. Create it (on
GitHub or wherever the owner keeps code) only with the owner's go-ahead,
which Gate 1 can include; until then work in a local folder.

```
<app>/
  docs/serverless/
    assessment.json  project.json        # the data; the validator reads these
    report.md        delivery.md         # generated: node <skill>/scripts/report.ts docs/serverless
    diagrams/*.md                        # one mermaid block per file
    adr/NNNN-*.md                        # decisions about the application
  spikes/<claim>/                       # fixtures that prove a claim during assessment
  src/  (Worker)   app/  (UI, if any)   tapedb.schema.ts   wrangler.jsonc
  test/unit/   test/integration/   e2e/
  .github/workflows/ci.yml              # from templates/ci.yml
  README.md   RUNBOOK.md
```

## Before starting

1. Read `references/methodology.md` (evidence and statuses), then skim
   `catalog/tapedb.json` and `catalog/cloudflare.json`.
2. Re-check anything in the catalogs the task depends on and older than it
   can bear: a limit, a price, a beta, a TapeDB release. Use the registry and
   the docs, not memory. Update the entry and its `checkedAt`.
3. Read `references/engineering.md` before phase 3, `references/testing.md`
   before phase 6 and `references/deployment.md` before the first deploy.

## Phase 0: Intake

- Write the goal down as the owner said it, plus what done means to them.
- If they named a repository, pin it (clone, record the commit).
- If they described a product ("a GitHub equivalent"), pick one or two
  open-source reference upstreams that do it (for GitHub: Forgejo or Gitea;
  for Notion: AppFlowy or AFFiNE) and pin those. They are the source of the
  feature inventory and of the evidence, not code to copy. Say which you
  picked and why in the report.
- Ask nothing yet unless the request cannot be read at all. Questions about
  scale, users and must-haves go into the report as assumptions to confirm.

## Phase 1: Assess

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
   primitives (TapeDB, then Cloudflare products such as Artifacts for Git
   repositories) over new code, and recipes in `recipes/` over invention.
   Record semantic gaps: what the candidate does differently, not only what
   it lacks.
5. **Prove the risky claims early.** For each capability the verdict hinges
   on, build the smallest fixture that shows it in the application's
   `spikes/` and run it: its own npm project on the published packages,
   started under `tapedb dev` or `wrangler dev` by its tests (ADR 0003).
   A verdict resting on untested beta features says so.
6. **Write the verdict** in `assessment.json`: `go`, `go-with-exclusions`
   (list each exclusion and its nearest alternative) or `no-go` (with the
   nearest honest alternative: a container, a VPS, a managed service).
7. **Validate:** `node <skill>/scripts/validate.ts docs/serverless`.

## Phase 2: Report (Gate 1)

Generate `report.md` (`node <skill>/scripts/report.ts docs/serverless`) and
hand the owner a short summary alongside it:

- the verdict in one paragraph: what will work serverless, what will not,
  what that costs them;
- a draft MoSCoW (musts, shoulds, coulds, won'ts), each linked to the
  capabilities it needs, with their statuses;
- the assumptions to confirm (users, scale, data size, must-haves), the
  monthly cost at the stated volumes, and the beta or unverified pieces;
- what they approve: the scope, the repository to create, and whether you may
  deploy previews to their Cloudflare account.

Record the answer in `project.json` `approval` (who, when, notes on scope
changes). No-go stops here with the alternative.

## Phases 3 to 9: Engineering

Follow `references/engineering.md`. In short:

3. **Requirements.** `project.json` against `schemas/project.schema.json`:
   actors; requirements with MoSCoW priority, rationale and the capabilities
   they depend on; use cases with preconditions, main and alternate flows and
   acceptance criteria, each criterion tied to test ids added to
   `assessment.json` as `not-run` with a `level`. A must cannot depend on an
   unsupported capability. Won'ts say why.
4. **Design.** Diagrams in mermaid (`templates/diagrams.md`): context,
   container, data model, deployment, a sequence diagram for every must use
   case, a state diagram for every entity with a lifecycle. ADRs for each
   real choice. API contract, the failure design checklist from
   `references/methodology.md`, cost from `references/costing.md`.
5. **Plan.** Milestones: M1 is a walking skeleton (repo, CI, one must use
   case end to end, deployed to a preview with an e2e test). Then the rest of
   the musts, then shoulds, then coulds.
6. **Build** one use case at a time: write its tests first, implement, run
   them, raise statuses only on a pass, commit. Reuse primitives; obey the
   rules below.
7. **Test** per `references/testing.md`: unit, integration in workerd,
   e2e with Playwright against a deployed preview, load where a
   non-functional requirement states a number, security checks.
8. **Deploy** per `references/deployment.md`: CI on every push, a Preview
   per branch, staging as a Wrangler environment, production only after
   Gate 3. Record every environment in `project.json`.
9. **Handover.** `delivery.md` (generated: MoSCoW with done flags,
   traceability from requirement to use case to test, milestones,
   environments, open work), README, `RUNBOOK.md` (`templates/runbook.md`),
   and a short message: what runs where, what is done, what is not.

Validate and regenerate reports at the end of every phase and before every
commit. Reports are generated; do not edit them by hand.

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
- Domain protocols (SAML, LDAP, Sentry envelopes, WhatsApp, email providers,
  Git) stay in application code, a Cloudflare product built for them
  (Artifacts for Git) or external services, not in the database.
- Costs come from current official pricing with stated volumes, or are marked
  UNPRICED (`references/costing.md`).
- Gates are the owner's. Never create repositories, deploy to their account,
  deploy to production, publish packages, buy plans or send messages without
  their explicit go-ahead. Report blockers instead of working around them.

## Reference shapes

- `schemas/`: what `assessment.json` and `project.json` hold.
- `tests/shapes.ts` and `tests/project.test.ts`: the smallest valid
  assessment and project.
