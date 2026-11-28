# License review

Checked 2026-11-26.

## This repository

MIT (see `LICENSE`), the same license as TapeDB.

## Runtime dependencies

None. The validator, the report generator and the tests use Bun's standard
library only.

## Fixture dependencies (`examples/*`, not distributed)

Read from the installed `package.json` files of each fixture on 2026-11-26
(78 packages each, identical sets):

| license | packages |
| --- | --- |
| MIT | 63, including `@tapedb/tapedb` and `@tapedb/cli` |
| Apache-2.0 | 6 |
| MIT OR Apache-2.0 | 4, including `wrangler` |
| BSD-2-Clause | 2 |
| BSD-3-Clause | 1 |
| ISC | 1 |
| CC0-1.0 | 1 |
| LGPL-3.0-or-later | 1: `@img/sharp-libvips-linux-x64`, through `wrangler` → `miniflare` → `sharp` |

The LGPL component is a prebuilt native library that local development
tooling loads dynamically. It is not bundled into any Worker and nothing here
redistributes it, so it places no obligation on this repository. Re-check if
the fixtures are ever packaged with their `node_modules`.

## Upstreams

This repository holds no assessments of other projects. The skill records an
upstream's license in the application's own `assessment.json`, and the rules
for using upstream code are in `references/security.md`.

The fixtures are clean-room: they implement generic patterns (an inbox,
envelope ingest and grouping) without code from any upstream.
