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
| `docs/adr/` | decisions about this repository |
| `LICENSES.md` | license review |

## Where a run's output goes

Into the application's own repository: `docs/serverless/` for the
assessment, project, reports, diagrams and ADRs; `spikes/` for the fixtures
that prove claims; the code, tests and CI next to them. Nothing a run
produces is written to this repository (ADR 0005).

## Use the skill

`SKILL.md` follows the open Agent Skills format, so any agent that reads
skills can use it: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot,
OpenCode, Amp, Cline, Windsurf and others. The skill names no agent-specific
tools; it needs a shell, git and Node.js 22.18 or newer.

Install with the `skills` CLI, which knows each agent's folder:

```bash
npx skills add tapedb/serverless-anything-stack          # this project, agents you pick
npx skills add tapedb/serverless-anything-stack -g       # your user folder
npx skills add tapedb/serverless-anything-stack -a codex -a cursor
```

Or clone it into the folder your agent reads:

| agent | project | user |
| --- | --- | --- |
| Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, Amp, Cline | `.agents/skills/` | see the agent's docs (`~/.codex/skills/`, `~/.cursor/skills/`, `~/.gemini/skills/`, `~/.copilot/skills/`, ...) |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Windsurf | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` |

```bash
git clone https://github.com/tapedb/serverless-anything-stack .agents/skills/serverless-anything-stack
```

For an agent without skill support, add one line to its instructions file
(`AGENTS.md`, `GEMINI.md`, `.cursor/rules`, ...):

```
To build or port an application to run serverless on Cloudflare, follow <path>/serverless-anything-stack/SKILL.md.
```

Then say what you want built, for example "i want to build a github
equivalent to host my codebases" (or `/serverless-anything-stack ...` where
your agent has slash commands), or name a repository: "rebuild
https://github.com/owner/app on Cloudflare". For an assessment only, say so;
the skill stops after the report. The skill refers to its own files by
relative path.

## Check and test

Requires Node.js 22.18 or newer. The validator and report generator have no
dependencies and run straight from the skill folder (Bun works too).
Checking this repository needs its pinned dev dependencies:

```bash
npm ci
npm run check          # strict typecheck, then tests: validator, reports, catalogs,
                       # SKILL.md frontmatter as strict YAML, every template diagram
                       # parsed by mermaid, the CI template's jobs

# against an application's own docs/serverless/ directory
node scripts/validate.ts ../my-app/docs/serverless
node scripts/report.ts ../my-app/docs/serverless          # writes report.md, delivery.md
node scripts/report.ts --check ../my-app/docs/serverless  # fails if they are stale
```

## Limitations

- This repository runs no applications. Deployed results the recipes cite
  come from TapeDB's own staging runs; everything else is tested in the
  application the skill builds.
- The recipes do not test Basin SQL latency, deployed Queues behaviour,
  burst load, provider delivery with a failing provider, OIDC conformance or
  key rotation; each recipe says what it has not tested.
- The architecture rules match on component names; review still matters.
- TapeDB gaps found along the way are recorded in
  `catalog/tapedb.json` (`findings`) and reported upstream: the admin HTTP
  API does not apply schema defaults, and before tapedb 0.4.2 `init` left
  `npx tapedb-cli` resolving to a deprecated registry package.

## License

MIT; see `LICENSE`. Dependency and upstream licenses are reviewed in
`LICENSES.md`.
