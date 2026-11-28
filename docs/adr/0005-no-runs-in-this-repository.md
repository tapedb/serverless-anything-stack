# ADR 0005: This repository holds the skill, not its runs

**Status:** accepted, 2026-11-28

## Context

The repository had grown a `cases/` folder, one assessment per application
tried, with fixtures for some of them, and the skill told agents to write
each new assessment there. The owner does not want the skill to collect the things
they try with it: a run is theirs and belongs with the application it
produces.

## Decision

- `cases/` and `examples/` (fixtures built while trying applications) are removed. Their
  history stays in git.
- The skill writes everything a run produces (assessment, report, spikes,
  code, tests, deploy records) into the application's own repository, under
  `docs/serverless/` and `spikes/`, and never into its own folder.
- The scripts take the application's directory as an argument and have no
  default target in this repository. `bun run check` runs the unit tests.
- What stays: the skill, references, recipes, templates, schemas, scripts,
  and the catalogs. The recipes say what to test in the application.
- Catalog facts re-checked during a run may be proposed back as a separate
  change, never committed as part of the run.

## Consequences

There is no worked example to copy; the schemas, `tests/shapes.ts` and the
templates take that role. TapeDB findings stay in `catalog/tapedb.json`
because they describe TapeDB, not a run.
