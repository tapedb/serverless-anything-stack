# License review

Checked 2026-11-26.

## This repository

MIT (see `LICENSE`), the same license as TapeDB.

## Runtime dependencies

None. The validator and the report generator use Node.js's standard library
only, and run under Bun as well.

## Development dependencies (not distributed)

Pinned in `package.json` for `npm run check`: `typescript` (Apache-2.0),
`@types/node` and `@types/jsdom` (MIT), `@playwright/test` (Apache-2.0, types
for the Playwright template), `mermaid` (MIT) and `jsdom` (MIT) to parse the
template diagrams, `yaml` (ISC) to read the CI template. Checked 2026-11-28.

## Upstreams

This repository holds no assessments of other projects. The skill records an
upstream's license in the application's own `assessment.json`, and the rules
for using upstream code are in `references/security.md`.
