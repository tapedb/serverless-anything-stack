# ADR 0001: Statuses are gated by evidence and tests, in code

**Status:** accepted, 2026-11-26

## Context

Porting assessments fail in a predictable way: a diagram maps every upstream
service to a Cloudflare product, and the mapping is read as parity. The
handoff requires that "verified" never appear without evidence and a test.

## Decision

Assessments are JSON validated against `schemas/assessment.schema.json`, and
`scripts/validate.ts` enforces rules the schema cannot express: `verified`
needs upstream evidence, dated candidate evidence and a passing acceptance
test, and has no gaps; `partial` names its gaps; `unsupported` is never
reused; a "deployed" claim needs a deployed test; cost sources must be
pricing evidence. Reports are generated from the JSON (`scripts/report.ts`)
and a test fails when one is stale.

## Consequences

Writing an assessment is slower than writing a document, and statuses stay
low until fixtures exist. Both are the point. The validator has no runtime
dependencies, so it runs anywhere Node.js 22.18+ or Bun does.
