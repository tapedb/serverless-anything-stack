# Serverless Anything Stack

An agent skill that builds a serverless, Cloudflare-native version of a
self-hosted app or a product idea, end to end:

```
/serverless-anything-stack i want to build a github equivalent to host my codebases
```

1. **Assess.** Picks and pins open-source reference upstreams (or the repo
   you name), audits them, maps every capability to TapeDB or a Cloudflare
   primitive, and proves the risky claims with small fixtures.
2. **Report.** Hands you a verdict (go, go with exclusions, no-go with the
   nearest alternative), a draft MoSCoW, costs at your volumes and the
   assumptions to confirm. You approve the scope.
3. **Engineer.** Requirements by MoSCoW, use cases with acceptance criteria,
   diagrams (context, container, data model, deployment, a sequence per must
   use case), ADRs, a plan with a walking skeleton first, the code in its own
   repository, unit, integration, e2e and load tests, CI, Previews per
   branch, staging, and production once you say so. Then a runbook and a
   delivery report.

Evidence rules hold throughout, and a validator enforces them: a capability
is verified only when a test passed, a must is done only when its acceptance
tests passed, nothing deploys to staging or production without your
go-ahead and e2e tests against it, and production waits for every must.

TapeDB is the preferred candidate for tenant state, live views and change
notifications when its guarantees fit. It is not mandatory, and the
validator refuses designs that rebuild what it already provides or put work
in it that it is not for.

## What is here

| path | what |
| --- | --- |
| `SKILL.md` | the skill: phases, gates, rules |
| `references/` | methodology and status rules; engineering (MoSCoW, use cases, design, plan), testing, deployment; TapeDB and Cloudflare guidance; security and licensing; costing |
| `templates/` | mermaid diagram starting points, GitHub Actions CI, Playwright config, runbook |
| `catalog/` | TapeDB (0.4.2 on npm) and Cloudflare capabilities: guarantees, limits, sources, check dates |
| `schemas/` | assessment, capability, decision and project (delivery) JSON schemas |
| `scripts/validate.ts` | schema plus rule validation: evidence, architecture and delivery gates |
| `scripts/report.ts` | renders `report.md` from an assessment and `delivery.md` from a project |
| `recipes/` | transactional, realtime, identity, async, ingestion, analytics patterns |
| `cases/` | Sanity (assessment plus delivery: the worked example), Keycloak, Chatwoot and GlitchTip, at pinned upstream revisions |
| `examples/` | executable fixtures: `inbox` (Chatwoot patterns), `ingest` (GlitchTip patterns), `cms` (Sanity patterns, also runs deployed) |
| `docs/adr/` | decisions about this repository |
| `LICENSES.md` | license review |

## The cases, as of 2026-11-28

| case | approach | capabilities | tests that ran |
| --- | --- | --- | --- |
| [Sanity](cases/sanity/report.md) ([delivery](cases/sanity/delivery.md)) | compatible rewrite as a CMS product on TapeDB: workspace per dataset, Studio on live queries and presence, delivery through webhooks, R2 and the Cache API; go with exclusions | 2 verified, 16 partial, 6 unverified, 1 not applicable; 6 of 7 musts done | 9 passed in workerd (the cms fixture, TapeDB webhooks and sessions), 7 passed deployed, 1 failed deployed (image transforms, account billing), 4 not run |
| [Keycloak](cases/keycloak/report.md) | compatible OIDC provider on Better Auth and TapeDB; SAML, LDAP and configurable flows excluded or external | 3 verified, 5 partial, 6 unverified, 4 unsupported | 8 passed in workerd (TapeDB's auth tests); OIDC conformance not run |
| [Chatwoot](cases/chatwoot/report.md) | compatible rewrite: TapeDB per account for state and live views; Queues and Workflows for delivery and timers | 2 verified, 6 partial, 5 unverified, 1 not applicable | 6 passed deployed (TapeDB staging scenarios), 3 passed in workerd (TapeDB webhooks, the inbox fixture) |
| [GlitchTip](cases/glitchtip/report.md) | ingest Worker, Queues, grouping consumer; issues in TapeDB, raw events in Basin | 5 partial, 6 unverified | 2 passed deployed (TapeDB staging scenarios), 3 passed in workerd (TapeDB webhooks, the ingest fixture) |

No case claims parity. Each report lists its gaps, risks, decisions and the
tests still to run.

## Use the skill

Claude Code discovers skills as folders containing a `SKILL.md`: personal
skills in `~/.claude/skills/<name>/`, project skills in
`.claude/skills/<name>/`. Clone or link this repository as one:

```bash
git clone https://github.com/tapedb/serverless-anything-stack ~/.claude/skills/serverless-anything-stack
```

Then say what you want built, for example
`/serverless-anything-stack i want to build a github equivalent to host my codebases`,
or name a repository: "rebuild https://github.com/owner/app on Cloudflare".
For an assessment only, say so; the skill stops after the report. On claude.ai, upload the folder as a skill (zip it with
`SKILL.md` at the top). Other runners that read `SKILL.md` frontmatter work
the same way; the skill refers to its files by relative path.

## Check and test

Requires [Bun](https://bun.sh) 1.4 or newer; the fixtures also need Node 22.18+
and npm.

```bash
bun run check          # unit tests, validation of every case, report freshness
bun run validate       # validation only
bun run report         # regenerate cases/*/report.md and delivery.md

# against an application's own docs/serverless/ directory
bun scripts/validate.ts ../my-app/docs/serverless
bun scripts/report.ts ../my-app/docs/serverless
bun run test:fixtures  # install and run every fixture (starts tapedb dev for each)
```

Each fixture also runs alone: `cd examples/inbox && npm ci && npm test`. A
fixture writes fresh local secrets to `.dev.vars` on first run.

## Limitations

- The `inbox` and `ingest` fixtures have run only locally (workerd under
  `tapedb dev`, local Queues). The `cms` fixture also runs against a
  temporary deployment (`npm run test:deployed`, from a machine with a
  wrangler login). Other deployed results come from TapeDB's staging runs.
- Only the Sanity case has gone through the engineering phases, and its
  product lives in its own repository; the other cases stop at the report.
- Basin SQL latency, deployed Queues behaviour, burst load, provider delivery
  with a failing provider, an OIDC conformance run and key rotation are not
  tested. Capabilities that depend on them say so.
- The architecture rules match on component names; review still matters.
- TapeDB gaps found while building this are recorded in
  `catalog/tapedb.json` (`findings`) and reported upstream: the admin HTTP
  API does not apply schema defaults, and before tapedb 0.4.2 `init` left
  `npx tapedb-cli` resolving to a deprecated registry package.

## License

MIT; see `LICENSE`. Dependency and upstream licenses are reviewed in
`LICENSES.md`.
