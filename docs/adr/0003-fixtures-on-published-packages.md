# ADR 0003: Fixtures run on published packages under `tapedb dev`

**Status:** accepted, 2026-11-26

## Context

A fixture proves a claim only if it runs what a user would run. Fixtures
built against a TapeDB checkout would prove the checkout, and 0.4.0 showed
that a checkout and the published package can differ.

## Decision

Each fixture in `examples/` is its own npm project pinned to an exact
published `@tapedb/tapedb` and `@tapedb/cli`, generates its own local secrets,
starts `tapedb dev` (workerd, real WorkspaceRooms, local Queues) from its
tests, and talks to it through the public client or the admin HTTP API.
Results are recorded as `runtime: workerd-local`.

## Consequences

Fixtures are slower (a dev server per test file) and need network access to
install. Deployed results need a deployed run on an account the owner
chooses; until then every fixture result says `workerd-local`, and nothing
here claims deployed behaviour from them.
