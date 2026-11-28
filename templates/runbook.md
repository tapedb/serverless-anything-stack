# <App> runbook

## Environments

| environment | URL | Worker | deployed by | data |
| --- | --- | --- | --- | --- |
| preview | per branch, posted on the pull request | `<app>` (Previews) | CI | test resources from the `previews` block |
| staging | <url> | `<app>-staging` | CI on main | its own buckets, queues, namespaces |
| production | <url> | `<app>` | manual CI job, owner approves | production |

## Secrets

| secret | environments | where it lives | who rotates it | how |
| --- | --- | --- | --- | --- |
| CLOUDFLARE_API_TOKEN | CI | GitHub secrets | owner | dashboard → API tokens, then update the secret |

## Deploy

1. Merge to main; CI deploys staging and runs e2e.
2. Run the `ci` workflow with `production: true`; the owner approves the
   `production` environment.
3. Smoke tests run; record the version in `docs/serverless/project.json`.

## Roll back

1. `npx wrangler rollback` (or `wrangler versions deploy <previous>@100%`).
2. Schema migrations do not roll back; they are additive, so the previous
   version runs against the new schema. Last known good version: `<id>`.

## Migrations

How TapeDB and Durable Object migrations are generated, reviewed, tested on
staging and applied.

## When something breaks

| signal | where | meaning | do |
| --- | --- | --- | --- |
| error rate up after a deploy | Workers Logs / Observability | the new version | roll back |
| dead-letter queue not empty | Queues → <name>-dlq | deliveries gave up | read, fix, replay |

## Backups and restore

What is backed up, how often, where, how to restore, when it was last tested.

## Costs to watch

Drivers from the assessment's cost model and the dashboard page for each.
