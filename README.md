# Serverless Anything Stack

An agent skill and reference stack for one question: can this self-hosted
application run on Cloudflare without a server, and what exactly would be
missing? The answer is an assessment in which every capability has upstream
evidence, a candidate, a status a validator enforces, and the tests behind
it.

TapeDB is the preferred candidate for tenant state, live views and
change notifications when its guarantees fit. It is not mandatory, and the
validator refuses designs that rebuild what it already provides or put work
in it that it is not for.

## What is here

| path | what |
| --- | --- |
| `SKILL.md` | the skill: procedure, rules, output |
| `references/` | methodology and status rules, TapeDB and Cloudflare guidance, security and licensing, costing |
| `catalog/` | TapeDB (0.4.1 on npm) and Cloudflare capabilities: guarantees, limits, sources, check dates |
| `schemas/` | assessment, capability and decision JSON schemas |
| `scripts/validate.ts` | schema plus rule validation, including the architecture rules |
| `scripts/report.ts` | renders each case's `report.md` from its JSON |
| `recipes/` | transactional, realtime, identity, async, ingestion, analytics patterns |
| `cases/` | Keycloak, Chatwoot and GlitchTip, at pinned upstream revisions |
| `examples/` | executable fixtures: `inbox` (Chatwoot patterns), `ingest` (GlitchTip patterns) |
| `docs/adr/` | decisions about this repository |
| `LICENSES.md` | license review |

## The cases, as of 2026-11-26

| case | approach | capabilities | tests that ran |
| --- | --- | --- | --- |
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
git clone <this repository> ~/.claude/skills/serverless-anything
```

Then ask for an assessment, for example "assess https://github.com/owner/app
for Cloudflare". On claude.ai, upload the folder as a skill (zip it with
`SKILL.md` at the top). Other runners that read `SKILL.md` frontmatter work
the same way; the skill refers to its files by relative path.

## Check and test

Requires [Bun](https://bun.sh) 1.4 or newer; the fixtures also need Node 22.18+
and npm.

```bash
bun run check          # unit tests, validation of every case, report freshness
bun run validate       # validation only
bun run report         # regenerate cases/*/report.md after editing assessments
bun run test:fixtures  # install and run both fixtures (starts tapedb dev for each)
```

Each fixture also runs alone: `cd examples/inbox && npm ci && npm test`. A
fixture writes fresh local secrets to `.dev.vars` on first run.

## Limitations

- Fixture results are local (workerd under `tapedb dev`, local Queues). No
  fixture has run against a deployment; deployed results here come from
  TapeDB's own staging runs.
- Basin SQL latency, deployed Queues behaviour, burst load, provider delivery
  with a failing provider, an OIDC conformance run and key rotation are not
  tested. Capabilities that depend on them say so.
- The architecture rules match on component names; review still matters.
- TapeDB gaps found while building this are recorded in
  `catalog/tapedb.json` (`findings`) and reported upstream: the admin HTTP
  API does not apply schema defaults, and before tapedb PR #118 `init` left
  `npx tapedb-cli` resolving to a deprecated registry package.

## Status

Not published. The repository name, its visibility and its license are the
owner's decisions (see `LICENSES.md`).
