# Testing

Every acceptance criterion in `project.json` names tests; every test is an
entry in `assessment.json` `tests` with a `level` and a `runtime`. A test that
has not run is `not-run`; the list of those is the backlog in `delivery.md`.

## The levels

| level | what | runtime | tools |
| --- | --- | --- | --- |
| `unit` | pure functions: validation, permission checks, parsers, formatters | `local` | `bun test` or Vitest |
| `integration` | the Worker with its real bindings: TapeDB workspaces, Durable Objects, Queues, R2, Artifacts | `workerd-local` | `tapedb dev` (as in `examples/`), or the Workers Vitest integration (`@cloudflare/vitest-pool-workers`), or `wrangler dev` |
| `e2e` | the application as a user or client drives it: browser flows, Git clone and push, API calls with real tokens | `deployed` (a Preview or staging) | Playwright for the UI (`templates/playwright.config.ts`), the real client for protocols (`git`, an SDK) |
| `load` | a non-functional requirement with a number in it | `deployed` | k6, autocannon, or a script; state the volume and where it ran from |
| `security` | authz refusals, tenancy isolation, secrets not exposed, dependency audit | `workerd-local` and `deployed` | tests that expect 401/403/404, `npm audit`, gitleaks |
| `smoke` | after every deploy: the app answers, one sign-in, one read | `deployed` | a few Playwright or fetch checks |

## Rules

- **One suite, two targets.** Integration and e2e tests read the base URL
  from an environment variable (`APP_URL`, as `CMS_URL` in `examples/cms`) and
  start a local server only when it is unset. The same tests then run
  against `tapedb dev` and against a deployment.
- **Negative controls.** For each guarantee, a test that would fail if the
  guarantee did not hold: the refused write, the duplicate delivery counted,
  the other tenant's data not visible.
- **Every must use case has an e2e test on `deployed`.** Local passes do not
  close a must for production.
- **Alternate flows get tests**, not only the main flow.
- **Data.** Tests create their own tenant (a fresh workspace, a random repo
  name) and do not depend on order. Deployed runs clean up what they made or
  run in a Preview that is thrown away.
- **Record what ran.** After a run, set `result`, `ranAt` (date), `command`,
  and `runtime`; add `evidence` for a measured number. Never mark a test
  `pass` from reading code.
- **Flaky is failing.** A test that passes on retry records `fail` until the
  cause is found; note the cause in the test description.

## e2e with Playwright

- Config in `templates/playwright.config.ts`: `baseURL` from `APP_URL`,
  traces and screenshots on failure, one worker per test file.
- One spec per use case (`e2e/uc-1-create-repository.spec.ts`), named after
  the use case so failures trace back to it.
- Sign in through the app's real flow, or through a test-only route that
  only the Preview enables and that answers only a per-run token (the
  pattern in `examples/cms/scripts/deployed.mjs`). Never in production.
- CI runs e2e after the Preview deploy, against its URL
  (`templates/ci.yml`), and uploads the Playwright report as an artifact.

## What goes into delivery.md

The traceability table (requirement → use case → tests → passing) and the
open work list come from these entries. Keep descriptions short and specific:
"A collaborator without write access cannot push (403) and the ref is
unchanged", not "push permissions".
