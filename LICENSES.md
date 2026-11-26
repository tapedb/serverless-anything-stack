# License review

Checked 2026-11-26.

## This repository

No license has been chosen yet; that is the owner's decision, together with
the repository's name and visibility. Until then, all rights are reserved by
the owner.

## Runtime dependencies

None. The validator, the report generator and the tests use Bun's standard
library only.

## Fixture dependencies (`examples/*`, not distributed)

Read from the installed `package.json` files of each fixture (78 packages
each, identical sets):

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

## Upstreams assessed

| upstream | revision | license | used here |
| --- | --- | --- | --- |
| Keycloak | `3e5160a` | Apache-2.0 | read for the assessment; no code copied |
| Chatwoot | `eb4fabb` | MIT outside `enterprise/`; `enterprise/` under its own license | read for the assessment; no code copied; enterprise features excluded |
| GlitchTip | `76307e8` | MIT | read for the assessment; no code copied |

The fixtures are clean-room: they implement behaviour described in the
assessments (an inbox, Sentry-style envelope ingest and grouping) without
upstream code. Protocol compatibility is not copying; upstream names and marks
belong to their owners, and nothing here presents itself as the upstream
product.
