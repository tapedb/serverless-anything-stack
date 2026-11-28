# ADR 0004: The skill builds the application; the assessment is its first phase

**Status:** accepted, 2026-11-28

## Context

The skill was written as an assessment tool: it answered "can this run on
Cloudflare without a server?" and built code only "if asked", as the
smallest fixture that proves a claim. Agents read it that way. The owner
wanted the opposite: say what to build ("a GitHub equivalent to host my
codebases"), get a feasibility report, and then have the engineering done:
MoSCoW, use cases, diagrams, tests, e2e, deployments.

## Decision

The skill runs ten phases with three gates owned by the owner: approval of
the report's scope (Gate 1), a Cloudflare account and go-ahead before the
first deploy (Gate 2), and production (Gate 3). The engineering record is
`project.json` (`schemas/project.schema.json`) next to the assessment, and
`scripts/validate.ts` checks it: requirements trace to use cases and use
cases to tests; musts never depend on unsupported capabilities; engineering
does not start before approval; the design has context, container, data
model and deployment diagrams and a sequence diagram per must use case; a
done milestone's tests passed; staging and production carry the owner's
go-ahead and deployed e2e tests; production waits for every must, each with
a test that passed deployed. `delivery.md` is generated from it.

Assessments gain a `verdict` (go, go-with-exclusions, no-go) and tests a
`level`. The application lives in its own repository with the data under
`docs/serverless/`; the scripts take that directory as an argument.

## Consequences

The evidence rules from ADR 0001 now cover delivery as well as assessment:
"done" and "deployed" mean what a test showed. The Sanity case carries a
full `project.json` as the worked example. The other cases stay
assessments.
