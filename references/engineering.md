# Engineering: from an approved assessment to a running application

Phases 3 to 9 of `SKILL.md`. Everything here is recorded in
`docs/serverless/project.json` (schema: `schemas/project.schema.json`) and
checked by `scripts/validate.ts`; `delivery.md` is generated from it.

## Phase 3: Requirements

### Actors

Who uses the system, including machines: `owner`, `collaborator`,
`anonymous reader`, `git client`, `CI runner`, `webhook consumer`. One line
each on what they need.

### MoSCoW

One requirement per thing the owner would notice if it were missing.

| priority | means | rule |
| --- | --- | --- |
| must | the release is useless without it | in a milestone; every acceptance test passes before production; never depends on an `unsupported` or `not-applicable` capability |
| should | important, the release still works without it | has use cases; scheduled after the musts |
| could | nice to have | has use cases; built only if time allows |
| wont | not in this release | `rationale` says why: infeasible on Workers, out of scope, later |

Start from the draft MoSCoW in the report and the owner's answer at Gate 1.
Excluded capabilities become won'ts with the verdict's alternative as the
rationale. Non-functional requirements (latency, availability, cost ceiling,
data residency, security) are requirements too: set `nonFunctional: true`
and give them a use case whose acceptance criterion states the number.

### Use cases

For each must, should and could: one or more use cases.

- **Actor**, **preconditions**, **main flow** as numbered steps the actor
  and the system take, **alternate flows** for errors, refusals and edge
  cases (wrong permissions, concurrent edits, retries, quota reached).
- **Acceptance criteria**: observable outcomes, written as given/when/then
  where that helps. Each one names the test ids that prove it.
- Add each test to `assessment.json` `tests` with `result: "not-run"`,
  `runtime` where it will run and `level` (`unit`, `integration`, `e2e`,
  `load`, `security`, `smoke`). Every must use case needs at least one `e2e`
  test with `runtime: "deployed"`.

Use case ids are `UC-1`, `UC-2`...; requirement ids `R1`, `R2`...

## Phase 4: Design

Diagrams are mermaid blocks in Markdown files under `docs/serverless/diagrams/`,
registered in `project.json` `diagrams`. Starting points are in
`templates/diagrams.md`. The validator requires, once the project is approved:

| kind | shows |
| --- | --- |
| `context` | the system, its actors, and external systems (Git clients, identity providers, email, payment) |
| `container` | each Worker, Durable Object class, TapeDB workspace type, Queue, Workflow, R2 bucket, Artifacts namespace, and what talks to what |
| `data-model` | entities, keys, relations, which workspace or store owns each |
| `deployment` | Cloudflare account, environments (preview, staging, production), bindings per environment, domains |
| `sequence` | one per must use case (`covers`), including the failure path |
| `state` | one per entity with a lifecycle (draft → published, open → merged → closed) |

Also write, in `docs/serverless/adr/`, one ADR per real choice (store,
auth, tenancy boundary, a primitive picked over another), and record each as
a `decisions` entry in the assessment. Write the API contract (routes,
request and response shapes, errors) in `docs/serverless/api.md` or as an
OpenAPI file. Fill the failure design checklist from `methodology.md` for
every asynchronous path, and the cost model from `costing.md` at the
volumes the owner confirmed.

## Phase 5: Plan

Milestones in `project.json`, each listing the requirements it delivers.

1. **M1 walking skeleton.** The repository, CI, the Wrangler config with a
   `previews` block, one must use case end to end with its unit,
   integration and e2e tests, deployed to a Preview. This proves the
   pipeline before features pile up.
2. **M2..Mn** the remaining musts, grouped so each milestone ships something
   the owner can try on a Preview URL.
3. Then shoulds, then coulds.

A milestone is `done` only when every acceptance test of its requirements
has passed (the validator checks).

## Phase 6: Build

Per use case:

1. Write the tests named in its acceptance criteria (they fail).
2. Implement with the chosen primitives: TapeDB for tenant state, live
   views and webhooks; Cloudflare products for the rest (`cloudflare.md`).
   No code copied from the upstream unless its license allows it and it is
   attributed (`security.md`).
3. Run unit and integration tests locally; push; let CI deploy the Preview
   and run e2e there.
4. Record results in `assessment.json` (`result`, `ranAt`, `command`),
   raise capability statuses only on a pass, lower them when a gap appears.
5. Regenerate reports, validate, commit. One commit per use case or fix,
   with a message that says what the owner can now do.

Keep the application small and boring: one Worker unless there is a reason
for two, TypeScript, the framework the UI needs (see the `frameworks-on-cloudflare`
skill when one is installed), no service the primitives already provide.

## Phase 7 and 8

`testing.md` and `deployment.md`.

## Phase 9: Handover

- `delivery.md` regenerated and committed.
- `README.md`: what it is, how to run it locally, how to deploy, where the
  docs are.
- `RUNBOOK.md` from `templates/runbook.md`: environments, secrets and who
  holds them, deploy and rollback, migrations, what alerts mean, the
  dead-letter queues and who reads them, backups and restore, costs to watch.
- A message to the owner: what is live and where, which musts are done,
  what is open (the `Open work` section of `delivery.md`), and the decisions
  you made on their behalf.
