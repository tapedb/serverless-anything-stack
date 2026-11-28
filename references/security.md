# Security, privacy and licensing

## In every assessment

- **Tenancy:** what is the isolation boundary, and which test shows one tenant
  cannot read another's data? (In TapeDB, a claim names one workspace; the
  inbox fixture checks that a claim for one account is refused by another's
  workspace with 403 `wrong_workspace`.)
- **Identity:** who issues identities, which protocol, which tests show
  single-use tokens stay single-use under a race, revocation works, and keys
  rotate. An identity provider ships only after a conformance run and an
  independent security review; say so as a release gate, not a footnote.
- **Backends acting as users:** name the identity a queue consumer or cron
  job acts as. TapeDB's admin API applies the rules to that identity; it is
  not a bypass.
- **Personal data:** which fields are personal, how erasure works (TapeDB
  personal fields and workspace erasure), and what leaves the platform
  (webhook bodies, provider sends, analytics tables).
- **Secrets:** Worker secrets, never `vars`. Local fixtures generate fresh
  `.dev.vars`; nothing secret is committed.
- **Inbound webhooks:** verify provider signatures before writing anything.

## Licensing

Record the upstream license at the pinned revision. Rules for this stack:

- Assessments and fixtures describe and re-implement behaviour; they copy no
  upstream code. That keeps them independent of the upstream license, which
  matters when a repository mixes licenses (MIT outside an `enterprise/`
  folder and a separate license inside it, for example).
- If code must be copied, check compatibility first, keep the notice, and say
  so in the report.
- Protocol compatibility (an OIDC endpoint, a Sentry envelope) is not
  copying, but names and marks are the owner's: do not present a rewrite as
  the upstream product.

The licenses of this repository's own dependencies are in `LICENSES.md`.
