# ADR 0006: Any agent, any model

**Status:** accepted, 2026-11-28

## Context

The skill was written and tested with one agent in mind: its README only
explained installing into that agent's folder, it pointed at a skill that
only some installations have, and its scripts and tests needed Bun. The
owner wants the skill usable from any agent.

## Decision

- `SKILL.md` stays in the open Agent Skills format (name and description
  frontmatter, relative paths) and names no agent-specific tools. It states
  what it needs from an agent: a shell, git, Node.js 22.18+, network, and a
  way to ask the owner and wait.
- The README installs it through the `skills` CLI or into each agent's
  folder, and gives a one-line instruction for agents without skill support.
- Scripts and tests run on plain Node.js (type stripping, `node:test`) with
  no dependencies; Bun still runs them.

## Consequences

The tests use a small `expect()` over `node:assert` (`tests/expect.ts`). No
agent gets features the others lack; an agent-specific helper may be added
only as an optional extra that the skill does not depend on.
