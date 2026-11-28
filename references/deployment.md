# Deployment

Facts are in `catalog/cloudflare.json` (`previews`, `workers`); re-check
them before relying on a detail. Each environment is an entry in
`project.json` `environments`; the validator refuses a deployed staging or
production without `approvedBy`, and any deployed environment without e2e
tests that passed against it.

## Gates

- **Gate 2, first deploy.** Needs a Cloudflare account the owner chose, the
  plan the design needs (Artifacts, for one, is Workers Paid only), and their
  go-ahead to deploy Previews there. Ask once; record it in `approval.notes`.
  Until then everything runs locally.
- **Gate 3, production.** Ask with: the version, the e2e results on staging,
  the must requirements done, the migrations that will run, the monthly cost
  at the stated volume, and the rollback. Record `approvedBy`.

Never create resources the owner pays for (a plan upgrade, a domain, a
paid add-on) without asking, even after Gate 2.

## Environments

| environment | what | how |
| --- | --- | --- |
| local | `tapedb dev` or `wrangler dev`, local bindings and simulators | `npm run dev` |
| preview | one per branch or pull request, isolated Durable Objects, preview bindings pointing at test resources | `npx wrangler preview` (CI or Workers Builds); settings in the Wrangler file's `previews` block |
| staging | a persistent, separately named Worker with its own bindings and data | `npx wrangler deploy --env staging` |
| production | the Worker on the owner's domain | `npx wrangler deploy` after Gate 3, or gradual: `wrangler versions upload` then `wrangler versions deploy` with a percentage |

Do not use Version URLs for branch testing: they run against production
resources.

## Configuration

- `wrangler.jsonc` holds production at the top level, a `previews` block for
  Previews, and `env.staging` for staging. Each has its own R2 buckets,
  Queues and Artifacts namespace; never share production data with a
  Preview.
- Secrets with `wrangler secret put` (per environment) or the CI secret
  store; never in the repository or in `vars`. List each secret, where it
  lives and who can rotate it in `RUNBOOK.md`.
- Durable Object classes need a `migrations` entry; TapeDB schema migrations
  are generated (`tapedb` CLI) and committed. Test a migration on staging
  with a copy of realistic data before production.
- Pin `compatibility_date`; raise it on purpose, with tests.

## CI

`templates/ci.yml` (GitHub Actions) on every push and pull request:

1. install, typecheck, unit tests;
2. integration tests in workerd;
3. on branches: `wrangler preview`, then e2e and smoke against its URL;
4. on the main branch: deploy staging, e2e and smoke on staging;
5. production: a manual `workflow_dispatch` job behind a protected GitHub
   environment, so the owner's approval is the click.

Needs `CLOUDFLARE_API_TOKEN` (scoped to the Workers, storage and Artifacts
permissions the app uses) and `CLOUDFLARE_ACCOUNT_ID` as repository secrets;
the owner creates the token. If the code lives in Artifacts instead of
GitHub, Workers Builds can build and deploy from the Artifacts repository
and create Previews for other branches.

## After every deploy

- Run smoke tests; record the environment's `version` (the Worker version id
  or commit), `deployedAt` and `e2eTests` in `project.json`.
- Watch Workers Logs and errors for the first minutes; a rise in errors is a
  rollback, not a hotfix.

## Rollback

- `wrangler rollback` to the previous version, or `wrangler versions deploy`
  back to it. Durable Object and TapeDB migrations do not roll back with
  code: make them additive (add columns, backfill, switch, remove later) so
  the previous version still runs against the new schema.
- Write the steps, and the last known good version, in `RUNBOOK.md`.
